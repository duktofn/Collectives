import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as editorApi from "../editor";
import { editorStore } from "../../stores/editor";
import { uiStore } from "../../stores/ui";
import {
  clearFolderRefReadinessForTests,
  folderRefReadiness,
  folderRefReadinessKey,
  getFolderRefReadiness,
  requestFolderRefChild,
  resolveFolderRefIntent,
  retryFolderRefChildFromEvent,
  setFolderRefReadinessForTests,
} from "./folderRefReadiness";

vi.mock("../editor", () => ({
  readFile: vi.fn(async () => ({ content: "old", versionToken: "old-token" })),
  readFolderRefSnapshot: vi.fn(),
  writeFile: vi.fn(async () => undefined),
}));

const snapshot = { content: "# New synthetic note", versionToken: "new-token" };
const baseIntent = {
  collectionId: "synthetic-collection",
  folderRefEntryId: "synthetic-folder-ref",
  rootPath: "C:/hotfix41/root",
  childPath: "C:/hotfix41/root/new-note.md",
  streamId: "synthetic-stream",
  subscriptionEpoch: "synthetic-epoch",
};

describe("FolderRef stale-read readiness", () => {
  beforeEach(() => {
    clearFolderRefReadinessForTests();
    uiStore.reset();
    vi.mocked(editorApi.readFolderRefSnapshot).mockReset();
  });

  afterEach(async () => {
    clearFolderRefReadinessForTests();
    await editorStore.closeFile(true);
  });

  it("retries only backend-classified transient reads exactly four times and commits the token once", async () => {
    vi.mocked(editorApi.readFolderRefSnapshot)
      .mockRejectedValueOnce({ code: "stale_read", message: "not ready", details: { classification: "retryable", reason: "absent_or_create_rename" } })
      .mockRejectedValueOnce({ code: "stale_read", message: "not ready", details: { classification: "retryable", reason: "absent_or_create_rename" } })
      .mockRejectedValueOnce({ code: "stale_read", message: "not ready", details: { classification: "retryable", reason: "absent_or_create_rename" } })
      .mockResolvedValueOnce(snapshot);

    expect(await requestFolderRefChild(baseIntent)).toBe(true);
    const intent = folderRefReadiness.state.activeIntent!;
    await resolveFolderRefIntent(intent);
    expect(editorApi.readFolderRefSnapshot).toHaveBeenCalledTimes(4);
    expect(editorStore.state.openFilePath).toBe(baseIntent.childPath);
    expect(editorStore.state.currentContent).toBe(snapshot.content);
    expect(editorStore.state.versionToken).toBe(snapshot.versionToken);
    expect(getFolderRefReadiness(baseIntent.collectionId, baseIntent.folderRefEntryId, baseIntent.childPath)?.status).toBe("ready");
  });

  it("does not retry a terminal backend error and keeps the child broken", async () => {
    vi.mocked(editorApi.readFolderRefSnapshot).mockRejectedValue({
      code: "stale_read",
      message: "outside root",
      details: { classification: "terminal", reason: "containment" },
    });
    expect(await requestFolderRefChild(baseIntent)).toBe(true);
    await resolveFolderRefIntent(folderRefReadiness.state.activeIntent!);
    expect(editorApi.readFolderRefSnapshot).toHaveBeenCalledTimes(1);
    const record = getFolderRefReadiness(baseIntent.collectionId, baseIntent.folderRefEntryId, baseIntent.childPath);
    expect(record?.status).toBe("broken");
    expect(record?.retryable).toBe(false);
    expect(editorStore.state.openFilePath).toBeNull();
  });

  it("does not start B or move selection when A save fails", async () => {
    vi.mocked(editorApi.readFile).mockResolvedValue({ content: "A", versionToken: "a-token" });
    vi.mocked(editorApi.writeFile).mockRejectedValue(new Error("save failed"));
    await editorStore.openFile("C:/hotfix41/root/a.md");
    editorStore.updateContent("A draft");
    uiStore.selectEntry("C:/hotfix41/root/a.md");
    expect(await requestFolderRefChild(baseIntent)).toBe(false);
    expect(uiStore.state.selectedEntryId).toBe("C:/hotfix41/root/a.md");
    expect(editorStore.state.openFilePath).toBe("C:/hotfix41/root/a.md");
    expect(folderRefReadiness.state.activeIntent).toBeNull();
    expect(editorApi.readFolderRefSnapshot).not.toHaveBeenCalled();
  });

  it("requires the active stream and epoch before an event can retry a broken child", async () => {
    vi.mocked(editorApi.readFolderRefSnapshot).mockResolvedValue(snapshot);
    const intent = { ...baseIntent, generation: 1 };
    setFolderRefReadinessForTests({
      key: folderRefReadinessKey(intent.collectionId, intent.folderRefEntryId, intent.childPath),
      intent,
      status: "broken",
      error: { code: "stale_read", message: "not ready", details: { classification: "retryable" } },
      retryable: true,
    });
    uiStore.selectEntry(intent.childPath);
    retryFolderRefChildFromEvent({ collectionId: intent.collectionId, streamId: "old", subscriptionEpoch: intent.subscriptionEpoch, changes: [{ changedFilePath: intent.childPath }] }, intent.rootPath, intent.folderRefEntryId);
    expect(editorApi.readFolderRefSnapshot).not.toHaveBeenCalled();
    retryFolderRefChildFromEvent({ collectionId: intent.collectionId, streamId: intent.streamId, subscriptionEpoch: intent.subscriptionEpoch, changes: [{ changedFilePath: intent.childPath }] }, intent.rootPath, intent.folderRefEntryId);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editorApi.readFolderRefSnapshot).toHaveBeenCalledOnce();
  });

  it("keeps two FolderRef child keys independent", () => {
    const other = { ...baseIntent, folderRefEntryId: "second-folder-ref", childPath: "C:/hotfix41/root/other.md" };
    expect(folderRefReadinessKey(baseIntent.collectionId, baseIntent.folderRefEntryId, baseIntent.childPath)).not.toBe(folderRefReadinessKey(other.collectionId, other.folderRefEntryId, other.childPath));
  });
});
