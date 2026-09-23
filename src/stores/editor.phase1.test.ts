import { beforeEach, describe, expect, it, vi } from "vitest";
import { editorStore } from "./editor";
import { uiStore } from "./ui";

vi.mock("../features/editor", () => ({
  readFile: vi.fn(async (path: string) => ({ content: `content:${path}`, versionToken: `token:${path}` })),
  writeFile: vi.fn(async () => undefined),
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
    vi.mocked(api.writeFile).mockImplementation(async () => undefined);
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
    let resolveWrite: (() => void) | undefined;
    vi.mocked(api.writeFile).mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveWrite = resolve;
    }));
    const first = editorStore.selectEntry("b.md");
    expect(editorStore.state.pendingSelection).toBe("b.md");
    const second = editorStore.selectEntry("c.md");
    resolveWrite?.();
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(uiStore.state.selectedEntryId).toBe("c.md");
    expect(editorStore.state.pendingSelection).toBe(null);
  });

  it("coalesces re-entrant close requests around one save", async () => {
    const api = await import("../features/editor");
    await editorStore.openFile("a.md");
    editorStore.updateContent("draft A");
    let resolveWrite: (() => void) | undefined;
    vi.mocked(api.writeFile).mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveWrite = resolve;
    }));
    const writesBefore = vi.mocked(api.writeFile).mock.calls.length;
    const first = editorStore.closeFile();
    const second = editorStore.closeFile();
    resolveWrite?.();
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
    let resolveA: (() => void) | undefined;
    vi.mocked(api.writeFile).mockReset();
    vi.mocked(api.writeFile).mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveA = resolve;
    })).mockImplementation(async () => undefined);
    const saveA = editorStore.saveFile();
    await Promise.resolve();
    editorStore.updateContent("revision B");
    const saveB = editorStore.saveFile();
    expect(vi.mocked(api.writeFile).mock.calls[0]?.[1]).toBe("revision A");
    resolveA?.();
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
    vi.mocked(api.writeFile).mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectA = reject;
    }))
      .mockImplementation(async () => undefined);
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
    let resolveA: (() => void) | undefined;
    vi.mocked(api.writeFile).mockReset();
    vi.mocked(api.writeFile).mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveA = resolve;
    })).mockImplementation(async () => undefined);
    const saveA = editorStore.saveFile();
    await Promise.resolve();
    editorStore.updateContent("revision B");
    const close = editorStore.closeFile();
    resolveA?.();
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
    let resolveA: (() => void) | undefined;
    vi.mocked(api.writeFile).mockReset();
    vi.mocked(api.writeFile).mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveA = resolve;
    })).mockImplementation(async () => undefined);
    const saveA = editorStore.saveFile();
    await Promise.resolve();
    editorStore.updateContent("revision B");
    const switchToB = editorStore.openFile("b.md");
    resolveA?.();
    await saveA;
    await switchToB;
    expect(vi.mocked(api.writeFile).mock.calls.map((call) => call[1])).toEqual(["revision A", "revision B"]);
    expect(editorStore.state.openFilePath).toBe("b.md");
  });
});
