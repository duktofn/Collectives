import { describe, it, expect, vi } from "vitest";
import { parseWikilink, serializeWikilink } from "./parser";
import { generateBlockId } from "../cm-extensions/block-ref";
import { resolveAndNavigate, navigateToFragment } from "./resolver";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

describe("Wikilink Parser", () => {
  it("should parse simple wikilink correctly", () => {
    const res = parseWikilink("[[Note]]");
    expect(res).toEqual({
      raw: "[[Note]]",
      noteName: "Note",
      fragment: null,
    });
  });

  it("should strip trailing .md case-insensitive", () => {
    const res = parseWikilink("[[My Note.md]]");
    expect(res).toEqual({
      raw: "[[My Note.md]]",
      noteName: "My Note",
      fragment: null,
    });

    const res2 = parseWikilink("[[Other.MD]]");
    expect(res2?.noteName).toBe("Other");
  });

  it("should parse wikilink with block fragment correctly", () => {
    const res = parseWikilink("[[Note#^abc123]]");
    expect(res).toEqual({
      raw: "[[Note#^abc123]]",
      noteName: "Note",
      fragment: {
        type: "block",
        value: "abc123",
      },
    });
  });

  it("should parse wikilink with heading fragment correctly", () => {
    const res = parseWikilink("[[Note#Heading Text]]");
    expect(res).toEqual({
      raw: "[[Note#Heading Text]]",
      noteName: "Note",
      fragment: {
        type: "heading",
        value: "Heading Text",
      },
    });
  });

  it("should return null for invalid wikilinks", () => {
    expect(parseWikilink("[[]]")).toBeNull();
    expect(parseWikilink("[[   ]]")).toBeNull();
    expect(parseWikilink("[[#^abc]]")).toBeNull();
  });

  it("should serialize wikilink correctly", () => {
    const token = {
      noteName: "Note",
      fragment: null,
    };
    expect(serializeWikilink(token)).toBe("[[Note]]");

    const tokenBlock = {
      noteName: "Note",
      fragment: { type: "block" as const, value: "abc" },
    };
    expect(serializeWikilink(tokenBlock)).toBe("[[Note#^abc]]");

    const tokenHeading = {
      noteName: "Note",
      fragment: { type: "heading" as const, value: "My Heading" },
    };
    expect(serializeWikilink(tokenHeading)).toBe("[[Note#My Heading]]");
  });
});

describe("Block ID Generator", () => {
  it("should generate 6-character alphanumeric IDs", () => {
    const id = generateBlockId(new Set());
    expect(id).toMatch(/^[a-z0-9]{6}$/);
  });

  it("should avoid duplicates in existingIds set", () => {
    const existing = new Set(["aaaaaa", "bbbbbb"]);
    const id = generateBlockId(existing);
    expect(existing.has(id)).toBe(false);
  });
});

describe("Wikilink Resolver", () => {
  const token = (noteName: string) => ({
    raw: `[[${noteName}]]`,
    noteName,
    fragment: null,
  });
  const candidate = (entryId: string, path: string) => ({
    displayName: "exists",
    entryId,
    path,
    entryType: "file",
  });

  it("routes a sole candidate directly and preserves its fragment", async () => {
    const target = candidate("id123", "path/exists.md");
    const targetToken = { ...token("exists"), fragment: { type: "block" as const, value: "abc123" } };
    const onCandidates = vi.fn().mockResolvedValue("opened");
    const onNoMatch = vi.fn();
    const resolveCandidates = vi.fn().mockResolvedValue([target]);

    const outcome = await resolveAndNavigate(targetToken, {
      collectionId: "col-1",
      sourcePath: "path/source.md",
      isCurrent: () => true,
      resolveCandidates,
    }, { onCandidates, onNoMatch });

    expect(outcome).toBe("opened");
    expect(resolveCandidates).toHaveBeenCalledWith("col-1", "exists", "path/source.md");
    expect(onCandidates).toHaveBeenCalledWith([target], targetToken.fragment);
    expect(onNoMatch).not.toHaveBeenCalled();
  });

  it("returns every duplicate to the chooser without selecting the first", async () => {
    const candidates = [candidate("short", "a/exists.md"), candidate("long", "folder/exists.md")];
    const onCandidates = vi.fn().mockResolvedValue("cancelled");
    const outcome = await resolveAndNavigate(token("exists"), {
      collectionId: "col-1",
      sourcePath: null,
      isCurrent: () => true,
      resolveCandidates: vi.fn().mockResolvedValue(candidates),
    }, { onCandidates, onNoMatch: vi.fn() });

    expect(outcome).toBe("cancelled");
    expect(onCandidates).toHaveBeenCalledWith(candidates, null);
  });

  it("keeps missing and failed lookups distinct", async () => {
    const missingToken = token("missing");
    const onCandidates = vi.fn();
    const onNoMatch = vi.fn();
    const onError = vi.fn();
    const common = { collectionId: "col-1", sourcePath: null, isCurrent: () => true };
    await resolveAndNavigate(missingToken, {
      ...common,
      resolveCandidates: vi.fn().mockResolvedValue([]),
    }, { onCandidates, onNoMatch, onError });
    expect(onNoMatch).toHaveBeenCalledWith(missingToken);
    expect(onError).not.toHaveBeenCalled();

    const failedToken = token("indexfail");
    await resolveAndNavigate(failedToken, {
      ...common,
      resolveCandidates: vi.fn().mockRejectedValue(new Error("index unavailable")),
    }, { onCandidates, onNoMatch, onError });
    expect(onNoMatch).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failedToken, expect.any(Error));
  });

  it("rejects a candidate result after its editor context becomes stale", async () => {
    let current = true;
    let finish!: (value: ReturnType<typeof candidate>[]) => void;
    const onCandidates = vi.fn();
    const targetToken = token("exists");
    const resolution = resolveAndNavigate(targetToken, {
      collectionId: "col-1",
      sourcePath: "path/source.md",
      isCurrent: () => current,
      resolveCandidates: () => new Promise((resolve) => { finish = resolve; }),
    }, { onCandidates, onNoMatch: vi.fn() });
    current = false;
    finish([candidate("id123", "path/exists.md")]);
    expect(await resolution).toBe("stale");
    expect(onCandidates).not.toHaveBeenCalled();
  });

  it("should navigate to block fragment correctly", () => {
    const state = EditorState.create({
      doc: "Line 1\nLine 2 ^abc123\nLine 3",
    });

    const dispatch = vi.fn();
    const focus = vi.fn();
    const view = {
      state,
      dispatch,
      focus,
    } as unknown as EditorView;

    navigateToFragment(view, { type: "block", value: "abc123" });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: expect.objectContaining({ anchor: 7 }),
        scrollIntoView: true,
      })
    );
  });

  it("should navigate to heading fragment correctly", () => {
    const state = EditorState.create({
      doc: "# Heading 1\nLine 2\n## Heading 2",
    });

    const dispatch = vi.fn();
    const focus = vi.fn();
    const view = {
      state,
      dispatch,
      focus,
    } as unknown as EditorView;

    navigateToFragment(view, { type: "heading", value: "Heading 2" });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: expect.objectContaining({ anchor: 19 }),
        scrollIntoView: true,
      })
    );
  });
});
