import { describe, expect, it, vi } from "vitest";
import { createFolderRefFeedSubscription } from "./folderRefFeed";

describe("FolderRef v2 feed lifecycle", () => {
  it("reloads local children for matching changes and disposes cleanly", () => {
    const reload = vi.fn();
    const subscription = createFolderRefFeedSubscription(reload);
    const change = { kind: "folder-changed", entryId: "folder-entry", path: "C:/folder", changedFilePath: "C:/folder/note.md" };
    subscription.handle(change, "C:/folder", "folder-entry", true, false);
    expect(reload).toHaveBeenCalledOnce();
    subscription.dispose();
    subscription.handle(change, "C:/folder", "folder-entry", true, false);
    expect(reload).toHaveBeenCalledOnce();
  });
});
