import { describe, it, expect, vi } from "vitest";
import { parseWikilink, serializeWikilink } from "./parser";
import { generateBlockId } from "../cm-extensions/block-ref";
import { resolveAndNavigate, navigateToFragment } from "./resolver";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// Mock Tauri APIs
vi.mock("../tauri", () => {
  return {
    resolveWikilink: vi.fn((_collectionId: string, noteName: string) => {
      if (noteName === "exists") {
        return Promise.resolve({
          displayName: "exists",
          entryId: "id123",
          path: "path/exists.md",
          entryType: "file",
        });
      }
      return Promise.resolve(null);
    }),
  };
});

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
  it("should call onMatch when note exists", async () => {
    const token = {
      raw: "[[exists]]",
      noteName: "exists",
      fragment: null,
    };
    const onMatch = vi.fn();
    const onNoMatch = vi.fn();

    await resolveAndNavigate(token, "col-1", { onMatch, onNoMatch });

    expect(onMatch).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "exists" }),
      null
    );
    expect(onNoMatch).not.toHaveBeenCalled();
  });

  it("should call onNoMatch when note does not exist", async () => {
    const token = {
      raw: "[[doesnotexist]]",
      noteName: "doesnotexist",
      fragment: null,
    };
    const onMatch = vi.fn();
    const onNoMatch = vi.fn();

    await resolveAndNavigate(token, "col-1", { onMatch, onNoMatch });

    expect(onMatch).not.toHaveBeenCalled();
    expect(onNoMatch).toHaveBeenCalledWith(token);
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
