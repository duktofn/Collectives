import { beforeEach, describe, expect, it, vi } from "vitest";
import { editorStore } from "./editor";
import { uiStore } from "./ui";

vi.mock("../features/editor", () => ({
  readFile: vi.fn(async (path: string) => ({ content: `content:${path}`, versionToken: `token:${path}` })),
  writeFile: vi.fn(async () => undefined),
  createFile: vi.fn(async () => ({ versionToken: "copy-token" })),
  asSafetyError: vi.fn(() => null),
}));

describe("Phase 1 committed selection", () => {
  it("reloads an external version without writing the discarded draft", async () => {
    const api = await import("../features/editor");
    await editorStore.openFile("a.md");
    editorStore.updateContent("local draft");
    vi.mocked(api.writeFile).mockRejectedValue(new Error("external conflict"));
    await expect(editorStore.saveFile()).rejects.toThrow();
    vi.mocked(api.writeFile).mockClear();
    vi.mocked(api.readFile).mockResolvedValueOnce({ content: "external version", versionToken: "new-token" });
    expect(await editorStore.reloadAndDiscard()).toBe(true);
    expect(api.writeFile).not.toHaveBeenCalled();
    expect(editorStore.state.currentContent).toBe("external version");
    expect(editorStore.state.versionToken).toBe("new-token");
    expect(editorStore.state.isDirty).toBe(false);
  });

  it("retains the draft if reading the replacement fails", async () => {
    const api = await import("../features/editor");
    await editorStore.openFile("a.md");
    editorStore.updateContent("local draft");
    vi.mocked(api.readFile).mockRejectedValueOnce(new Error("unavailable"));
    expect(await editorStore.reloadAndDiscard()).toBe(false);
    expect(editorStore.state.currentContent).toBe("local draft");
    expect(editorStore.state.isDirty).toBe(true);
    expect(api.writeFile).not.toHaveBeenCalled();
  });
  beforeEach(async () => {
    await editorStore.closeFile(true);
    uiStore.selectEntry(null);
    const api = await import("../features/editor");
    vi.clearAllMocks();
    vi.mocked(api.readFile).mockImplementation(async (path: string) => ({ content: `content:${path}`, versionToken: `token:${path}` }));
    vi.mocked(api.writeFile).mockImplementation(async () => ({ versionToken: "token:a.md" }));
    vi.mocked(api.createFile).mockImplementation(async () => ({ versionToken: "copy-token" }));
  });

  it("does not commit B when flushing dirty A fails", async () => {
    const api = await import("../features/editor");
    vi.mocked(api.writeFile).mockRejectedValueOnce({ code: "external_change_conflict", message: "changed" });
    await editorStore.openFile("a.md");
    await editorStore.selectEntry("a.md");
    editorStore.updateContent("draft A");
    const committed = await editorStore.selectEntry("b.md");
    expect(committed).toBe(false);
    expect(uiStore.state.selectedEntryId).toBe("a.md");
    expect(editorStore.state.currentContent).toBe("draft A");
  });

  it("returns failure from close and retains the draft on save failure", async () => {
    const api = await import("../features/editor");
    await editorStore.openFile("a.md");
    editorStore.updateContent("draft A");
    vi.mocked(api.writeFile).mockRejectedValueOnce({ code: "external_change_conflict", message: "changed" });
    expect(await editorStore.closeFile()).toBe(false);
    expect(editorStore.state.openFilePath).toBe("a.md");
    expect(editorStore.state.currentContent).toBe("draft A");
    expect(await editorStore.reloadAndDiscard()).toBe(true);
    expect(editorStore.state.currentContent).toBe("content:a.md");
  });

  it("does not let a stale A read replace committed B", async () => {
    const api = await import("../features/editor");
    let resolveA: ((value: { content: string; versionToken: string }) => void) | undefined;
    let resolveB: ((value: { content: string; versionToken: string }) => void) | undefined;
    vi.mocked(api.readFile)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve; }));
    const a = editorStore.openFile("a.md");
    const b = editorStore.openFile("b.md");
    resolveB?.({ content: "B", versionToken: "B-token" });
    await b;
    resolveA?.({ content: "A", versionToken: "A-token" });
    await a;
    expect(editorStore.state.openFilePath).toBe("b.md");
    expect(editorStore.state.currentContent).toBe("B");
  });

  it("serializes concurrent selection requests and commits only the latest", async () => {
    const api = await import("../features/editor");
    await editorStore.openFile("a.md");
    await editorStore.selectEntry("a.md");
    editorStore.updateContent("draft A");
    let resolveWrite: ((receipt: { versionToken: string }) => void) | undefined;
    vi.mocked(api.writeFile).mockImplementationOnce(() => new Promise<{ versionToken: string }>((resolve) => {
      resolveWrite = resolve;
    }));
    const first = editorStore.selectEntry("b.md");
    expect(editorStore.state.pendingSelection).toBe("b.md");
    const second = editorStore.selectEntry("c.md");
    resolveWrite?.({ versionToken: "token:a.md" });
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(uiStore.state.selectedEntryId).toBe("c.md");
    expect(editorStore.state.pendingSelection).toBe(null);
  });

  it("coalesces re-entrant close requests around one save", async () => {
    const api = await import("../features/editor");
    await editorStore.openFile("a.md");
    editorStore.updateContent("draft A");
    let resolveWrite: ((receipt: { versionToken: string }) => void) | undefined;
    vi.mocked(api.writeFile).mockImplementationOnce(() => new Promise<{ versionToken: string }>((resolve) => {
      resolveWrite = resolve;
    }));
    const writesBefore = vi.mocked(api.writeFile).mock.calls.length;
    const first = editorStore.closeFile();
    const second = editorStore.closeFile();
    resolveWrite?.({ versionToken: "token:a.md" });
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(editorStore.state.openFilePath).toBe(null);
    expect(vi.mocked(api.writeFile).mock.calls.length).toBe(writesBefore + 1);
  });

  it("writes revision B after an in-flight revision A", async () => {
    const api = await import("../features/editor");
    await editorStore.openFile("a.md");
    await editorStore.selectEntry("a.md");
    editorStore.updateContent("revision A");
    let resolveA: ((receipt: { versionToken: string }) => void) | undefined;
    vi.mocked(api.writeFile).mockReset();
    vi.mocked(api.writeFile).mockImplementationOnce(() => new Promise<{ versionToken: string }>((resolve) => {
      resolveA = resolve;
    })).mockImplementation(async () => ({ versionToken: "token:a.md" }));
    const saveA = editorStore.saveFile();
    await Promise.resolve();
    editorStore.updateContent("revision B");
    const saveB = editorStore.saveFile();
    expect(vi.mocked(api.writeFile).mock.calls[0]?.[1]).toBe("revision A");
    resolveA?.({ versionToken: "token:a.md" });
    await Promise.all([saveA, saveB]);
    expect(vi.mocked(api.writeFile).mock.calls.map((call) => call[1])).toEqual(["revision A", "revision B"]);
    expect(editorStore.state.openFileContent).toBe("revision B");
    expect(editorStore.state.isDirty).toBe(false);
  });

  it("retains revision B when revision A fails and retries B without discarding it", async () => {
    const api = await import("../features/editor");
    await editorStore.openFile("a.md");
    await editorStore.selectEntry("a.md");
    editorStore.updateContent("revision A");
    let rejectA: ((reason: unknown) => void) | undefined;
    vi.mocked(api.writeFile).mockReset();
    vi.mocked(api.writeFile).mockImplementationOnce(() => new Promise<{ versionToken: string }>((_resolve, reject) => {
      rejectA = reject;
    }))
      .mockImplementation(async () => ({ versionToken: "token:a.md" }));
    const saveA = editorStore.saveFile();
    await Promise.resolve();
    editorStore.updateContent("revision B");
    const saveB = editorStore.saveFile();
    rejectA?.({ code: "save_failed", message: "A failed" });
    await expect(saveA).rejects.toBeTruthy();
    await expect(saveB).rejects.toBeTruthy();
    expect(editorStore.state.currentContent).toBe("revision B");
    expect(editorStore.state.isDirty).toBe(true);
    await editorStore.saveFile();
    expect(vi.mocked(api.writeFile).mock.calls.map((call) => call[1])).toEqual(["revision A", "revision B"]);
    expect(editorStore.state.openFileContent).toBe("revision B");
    expect(editorStore.state.isDirty).toBe(false);
  });

  it("makes close wait for every queued revision before clearing the document", async () => {
    const api = await import("../features/editor");
    await editorStore.openFile("a.md");
    await editorStore.selectEntry("a.md");
    editorStore.updateContent("revision A");
    let resolveA: ((receipt: { versionToken: string }) => void) | undefined;
    vi.mocked(api.writeFile).mockReset();
    vi.mocked(api.writeFile).mockImplementationOnce(() => new Promise<{ versionToken: string }>((resolve) => {
      resolveA = resolve;
    })).mockImplementation(async () => ({ versionToken: "token:a.md" }));
    const saveA = editorStore.saveFile();
    await Promise.resolve();
    editorStore.updateContent("revision B");
    const close = editorStore.closeFile();
    resolveA?.({ versionToken: "token:a.md" });
    await saveA;
    await close;
    expect(vi.mocked(api.writeFile).mock.calls.map((call) => call[1])).toEqual(["revision A", "revision B"]);
    expect(editorStore.state.openFilePath).toBe(null);
  });

  it("makes a switch wait for the full revision queue before reading B", async () => {
    const api = await import("../features/editor");
    await editorStore.openFile("a.md");
    await editorStore.selectEntry("a.md");
    editorStore.updateContent("revision A");
    let resolveA: ((receipt: { versionToken: string }) => void) | undefined;
    vi.mocked(api.writeFile).mockReset();
    vi.mocked(api.writeFile).mockImplementationOnce(() => new Promise<{ versionToken: string }>((resolve) => {
      resolveA = resolve;
    })).mockImplementation(async () => ({ versionToken: "token:a.md" }));
    const saveA = editorStore.saveFile();
    await Promise.resolve();
    editorStore.updateContent("revision B");
    const switchToB = editorStore.openFile("b.md");
    resolveA?.({ versionToken: "token:a.md" });
    await saveA;
    await switchToB;
    expect(vi.mocked(api.writeFile).mock.calls.map((call) => call[1])).toEqual(["revision A", "revision B"]);
    expect(editorStore.state.openFilePath).toBe("b.md");
  });

  it("saves a copy of the draft without writing or changing the original session", async () => {
    const api = await import("../features/editor");
    await editorStore.openFile("a.md");
    editorStore.updateContent("local draft that must survive");

    expect(await editorStore.saveDraftCopy("copy.md")).toBe(true);
    expect(api.createFile).toHaveBeenCalledWith("copy.md", "local draft that must survive");
    expect(api.writeFile).not.toHaveBeenCalled();
    expect(editorStore.state.openFilePath).toBe("a.md");
    expect(editorStore.state.openFileContent).toBe("content:a.md");
    expect(editorStore.state.currentContent).toBe("local draft that must survive");
    expect(editorStore.state.isDirty).toBe(true);
  });

  it("saves edits made while close is waiting for an earlier write", async () => {
    const api = await import("../features/editor");
    await editorStore.openFile("a.md");
    editorStore.updateContent("first draft");
    let finishWrite!: (receipt: { versionToken: string }) => void;
    vi.mocked(api.writeFile).mockImplementationOnce(() => new Promise((resolve) => { finishWrite = resolve; }));
    const closing = editorStore.closeFile();
    editorStore.updateContent("typed while closing");
    finishWrite({ versionToken: "first-commit" });
    expect(await closing).toBe(true);
    expect(vi.mocked(api.writeFile).mock.calls.map((call) => call[1])).toEqual(["first draft", "typed while closing"]);
    expect(vi.mocked(api.writeFile).mock.calls[1]?.[2]).toEqual({ kind: "version", token: "first-commit" });
  });

  it("coalesces intermediate revisions while a write is in flight", async () => {
    const api = await import("../features/editor");
    await editorStore.openFile("a.md");
    editorStore.updateContent("first");
    let finishWrite!: (receipt: { versionToken: string }) => void;
    vi.mocked(api.writeFile).mockImplementationOnce(() => new Promise((resolve) => { finishWrite = resolve; }));
    const first = editorStore.saveFile();
    editorStore.updateContent("intermediate");
    const intermediate = editorStore.saveFile();
    editorStore.updateContent("latest");
    const latest = editorStore.saveFile();
    finishWrite({ versionToken: "first-commit" });
    await Promise.all([first, intermediate, latest]);
    expect(vi.mocked(api.writeFile).mock.calls.map((call) => call[1])).toEqual(["first", "latest"]);
  });

  it("keeps the current session while the next file is loading and saves late edits", async () => {
    const api = await import("../features/editor");
    await editorStore.openFile("a.md");
    const generation = editorStore.state.generation;
    let finishRead!: (snapshot: { content: string; versionToken: string }) => void;
    vi.mocked(api.readFile).mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    const opening = editorStore.openFile("b.md");
    expect(editorStore.state.generation).toBe(generation);
    editorStore.updateContent("typed while loading B");
    finishRead({ content: "B", versionToken: "B-token" });
    await opening;
    expect(api.writeFile).toHaveBeenCalledWith("a.md", "typed while loading B", { kind: "version", token: "token:a.md" });
    expect(editorStore.state.openFilePath).toBe("b.md");
  });

  it("ignores an older failed read after a newer note has opened", async () => {
    const api = await import("../features/editor");
    let failRead!: (error: Error) => void;
    vi.mocked(api.readFile).mockImplementationOnce(() => new Promise((_resolve, reject) => { failRead = reject; }));
    const older = editorStore.openFile("a.md");
    await editorStore.openFile("b.md");
    failRead(new Error("old read failed"));
    await older.catch(() => {});
    expect(editorStore.state.openFilePath).toBe("b.md");
    expect(editorStore.state.error).toBeNull();
  });

  it("does not reopen a file after close cancels a switch waiting for a save", async () => {
    const api = await import("../features/editor");
    await editorStore.openFile("a.md");
    editorStore.updateContent("draft");
    let finishWrite!: (receipt: { versionToken: string }) => void;
    vi.mocked(api.writeFile).mockImplementationOnce(() => new Promise((resolve) => { finishWrite = resolve; }));
    const opening = editorStore.openFile("b.md");
    await editorStore.closeFile(true);
    finishWrite({ versionToken: "saved" });
    await opening;
    expect(api.readFile).not.toHaveBeenCalledWith("b.md");
    expect(editorStore.state.openFilePath).toBeNull();
  });

  it("keeps a failed current draft when another recovery draft is requested", async () => {
    const api = await import("../features/editor");
    await editorStore.openFile("a.md");
    editorStore.updateContent("keep this unsaved draft");
    vi.mocked(api.writeFile).mockRejectedValueOnce(new Error("save unavailable"));
    expect(await editorStore.restoreRecoveredDraft({
      id: "recover-b", collectionId: "collection", entryId: "b", path: "b.md",
      baseVersionToken: "b-token", content: "recovered B", revision: 1,
      sessionId: "recover-b", updatedAt: Date.now(),
    })).toBe(false);
    expect(editorStore.state.openFilePath).toBe("a.md");
    expect(editorStore.state.currentContent).toBe("keep this unsaved draft");
    expect(api.readFile).not.toHaveBeenCalledWith("b.md");
  });

  it("does not overwrite disk changes that arrived after comparison", async () => {
    const api = await import("../features/editor");
    await editorStore.openFile("a.md");
    editorStore.updateContent("local draft");
    vi.mocked(api.readFile).mockResolvedValueOnce({ content: "disk v1", versionToken: "disk-v1" });
    expect(await editorStore.handleFilesystemChange("a.md")).toBe(false);

    vi.mocked(api.readFile).mockResolvedValueOnce({ content: "disk v2", versionToken: "disk-v2" });
    expect(await editorStore.overwriteExternalVersion("disk-v1")).toBe(false);
    expect(api.writeFile).not.toHaveBeenCalled();
    expect(editorStore.state.currentContent).toBe("local draft");
    expect(editorStore.state.conflictKind).toBe("file");
  });

  it("restores a recovered draft as a conflict if its original file is missing", async () => {
    const api = await import("../features/editor");
    vi.mocked(api.readFile).mockRejectedValueOnce({ code: "stale_read", message: "missing" });
    const draft = {
      id: "collection\u0000entry\u0000a.md",
      collectionId: "collection",
      entryId: "entry",
      path: "a.md",
      baseVersionToken: "old-token",
      content: "recovered local text",
      revision: 3,
      sessionId: "recovery-session",
      updatedAt: Date.now(),
    };

    expect(await editorStore.restoreRecoveredDraft(draft)).toBe(true);
    expect(editorStore.state.openFilePath).toBe("a.md");
    expect(editorStore.state.currentContent).toBe("recovered local text");
    expect(editorStore.state.isDirty).toBe(true);
    expect(editorStore.state.conflictKind).toBe("file");
    expect(editorStore.state.error).toContain("recovered_file_missing");
  });

  it("does not serialize the editor document for every content update", async () => {
    const api = await import("../features/editor");
    await editorStore.openFile("a.md");
    let liveText = "live editor text";
    const reader = vi.fn(() => liveText);
    const unregister = editorStore.registerCurrentContentReader(reader);
    liveText = "revision one";
    editorStore.markContentChanged();
    liveText = "revision two";
    editorStore.markContentChanged();
    liveText = "final revision";
    editorStore.markContentChanged();
    expect(reader).not.toHaveBeenCalled();

    await editorStore.saveFile();
    expect(api.writeFile).toHaveBeenCalledWith("a.md", "final revision", { kind: "version", token: "token:a.md" });
    expect(reader.mock.calls.length).toBeLessThanOrEqual(2);
    unregister();
  });
  it("accepts a committed receipt with cleanup warnings without retrying", async () => {
    const api = await import("../features/editor");
    await editorStore.openFile("a.md");
    editorStore.updateContent("saved draft");
    vi.mocked(api.writeFile).mockResolvedValueOnce({ versionToken: "committed-token", warnings: [
      { code: "backup_cleanup_failed", message: "Temporary backup cleanup could not finish." },
    ] });
    await editorStore.saveFile();
    expect(editorStore.state.isDirty).toBe(false);
    expect(editorStore.state.error).toBeNull();
    expect(editorStore.state.conflictKind).toBeNull();
    expect(editorStore.state.versionToken).toBe("committed-token");
    expect(editorStore.state.saveNotice).toContain("Saved successfully");
    await editorStore.flushPendingSave();
    expect(api.writeFile).toHaveBeenCalledTimes(1);
    editorStore.updateContent("next draft");
    await editorStore.saveFile();
    expect(vi.mocked(api.writeFile).mock.calls[1]?.[2]).toEqual({ kind: "version", token: "committed-token" });
    expect(editorStore.state.saveNotice).toBeNull();
  });

  it("retains a dirty draft and blocks navigation when its parent disappeared", async () => {
    const api = await import("../features/editor");
    await editorStore.openFile("a.md");
    editorStore.updateContent("retain me");
    vi.mocked(api.asSafetyError).mockReturnValueOnce({ code: "parent_missing", message: "Folder disappeared" });
    vi.mocked(api.writeFile).mockRejectedValue({ code: "parent_missing", message: "Folder disappeared" });
    expect(await editorStore.openFile("b.md")).toBe(false);
    expect(editorStore.state.openFilePath).toBe("a.md");
    expect(editorStore.state.currentContent).toBe("retain me");
    expect(editorStore.state.isDirty).toBe(true);
    expect(editorStore.state.error).toContain("parent_missing");
  });

});
