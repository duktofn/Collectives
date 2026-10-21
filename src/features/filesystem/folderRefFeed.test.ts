import { afterEach, describe, expect, it, vi } from "vitest";
import { createFolderRefFeedSubscription, reconcileFolderRefChildren, shouldReloadFolderRef } from "./folderRefFeed";

describe("FolderRef v2 feed lifecycle", () => {
  it("retains unchanged rows through refreshes while applying changed and removed children", () => {
    const before = Array.from({ length: 1000 }, (_, i) => ({ path: `C:/folder/${i}.md`, name: `${i}.md`, isDir: false, size: 10 }));
    const next = before.slice(1).map(entry => ({ ...entry }));
    next[0].size = 20;
    const after = reconcileFolderRefChildren(before, next);
    expect(after).toHaveLength(999);
    expect(after[0]).toEqual({ ...before[1], size: 20 });
    expect(after[0]).not.toBe(before[1]);
    expect(after.slice(1).every((entry, index) => entry === before[index + 2])).toBe(true);
    const same = reconcileFolderRefChildren(after, after.map(entry => ({ ...entry })));
    expect(same.every((entry, index) => entry === after[index])).toBe(true);
  });
  afterEach(() => vi.useRealTimers());
  it("coalesces a burst and cancels pending reloads on disposal", async () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const subscription = createFolderRefFeedSubscription(reload);
    const change = { kind: "folder-changed", entryId: "folder-entry", path: "C:/folder", changedFilePath: "C:/folder/note.md" };
    for (let i = 0; i < 1000; i++) subscription.handle(change, "C:/folder", "folder-entry", true, false);
    expect(reload).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(reload).toHaveBeenCalledOnce();
    subscription.handle(change, "C:/folder", "folder-entry", true, false);
    subscription.dispose();
    subscription.handle(change, "C:/folder", "folder-entry", true, false);
    await vi.runAllTimersAsync();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("runs one followup for changes arriving during an asynchronous reload", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const reload = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const subscription = createFolderRefFeedSubscription(reload);
    const send = () => subscription.handle({ kind: "folder-changed", path: "C:/folder" }, "C:/folder", "entry", true, false);
    send();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 1000; i++) send();
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledOnce();
    finish();
    await vi.runAllTimersAsync();
    expect(reload).toHaveBeenCalledTimes(2);
    subscription.dispose();
  });

  it("matches child paths with separators without matching a sibling folder", () => {
    const matches = (changedFilePath: string) => shouldReloadFolderRef({ kind: "folder-changed", path: "other", changedFilePath }, "C:\\folder\\", "entry", true, false);
    expect(matches("C:/folder/note.md")).toBe(true);
    expect(matches("C:/folder-sibling/note.md")).toBe(false);
    expect(shouldReloadFolderRef({ kind: "folder-changed", path: "C:/folder" }, "C:/folder", "entry", false, false)).toBe(false);
  });
});
