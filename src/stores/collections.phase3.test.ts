import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCollections: vi.fn(),
  reconcileCollectionSnapshot: vi.fn(),
  syncCollectionWatches: vi.fn(async () => undefined),
  readFile: vi.fn(async (path: string) => ({ content: `content:${path}`, versionToken: `token:${path}` })),
  writeFile: vi.fn(async () => undefined),
  asSafetyError: vi.fn(() => null),
}));

vi.mock("../features/collections", () => ({ getCollections: mocks.getCollections, reconcileCollectionSnapshot: mocks.reconcileCollectionSnapshot, initializeIdentityCache: vi.fn(), validateEntries: vi.fn(async () => []), detectMovedEntry: vi.fn(async () => null), ...Object.fromEntries(["createCollection", "updateCollection", "deleteCollection", "addFileEntries", "addFolderRef", "createGroup", "renameGroup", "removeEntry", "deleteGroupAndPromote", "moveEntry", "applyCollectionMutationV2", "migrationStatus", "migrationRetry"].map((name) => [name, vi.fn()])) }));
vi.mock("../features/filesystem", () => ({ syncCollectionWatches: mocks.syncCollectionWatches, clearWatches: vi.fn(), watchEntry: vi.fn(), unwatchEntry: vi.fn(), watchFolder: vi.fn(), unwatchFolder: vi.fn() }));
vi.mock("../features/archive", () => ({ importFolder: vi.fn(), importZip: vi.fn(), exportCollectionToFolder: vi.fn(), exportCollectionToZip: vi.fn() }));
vi.mock("../features/editor", () => ({ readFile: mocks.readFile, writeFile: mocks.writeFile, asSafetyError: mocks.asSafetyError }));

import { getNormalizedCacheForTests, handleCollectionDeltaV2, handleFilesystemChangesV2, resetNormalizedCachesForTests, collectionsStore } from "./collections";
import { editorStore } from "./editor";
import { uiStore } from "./ui";
import type { Collection } from "../types";

const baseCollection = (): Collection => ({ id: "live", schemaVersion: 1, name: "Live", createdAt: "", updatedAt: "", entries: [{ type: "group", id: "group", name: "Group", children: [{ type: "file", id: "entry", path: "old.md" }] }] });

describe("live Phase 3 collection/feed integration", () => {
  beforeEach(async () => {
    await editorStore.closeFile(true);
    uiStore.selectEntry(null);
    mocks.getCollections.mockReset();
    mocks.getCollections.mockResolvedValue([baseCollection()]);
    mocks.reconcileCollectionSnapshot.mockReset();
    mocks.reconcileCollectionSnapshot.mockResolvedValue({ collection: baseCollection(), revision: 5, cursor: { streamId: "snapshot-stream", subscriptionEpoch: "snapshot-epoch", sequence: 0 } });
    mocks.syncCollectionWatches.mockClear();
    resetNormalizedCachesForTests();
    await collectionsStore.loadCollections();
  });

  it("projects an accepted delta into the live tree before any watch resync", async () => {
    const result = await handleCollectionDeltaV2({ collectionId: "live", revision: 1, mutationId: "rename", origin: "ui", changes: [{ entryId: "entry", kind: "updated", entry: { id: "entry", parentId: null, entryType: "file", name: null, path: "renamed.md", sortOrder: 0 } }] });
    expect(result.accepted).toBe(true);
    expect(collectionsStore.state.collections[0].entries[0]).toEqual({ type: "file", id: "entry", path: "renamed.md" });
    expect(collectionsStore.state.collections[0].entries[1]).toEqual({ type: "group", id: "group", name: "Group", children: [] });
    expect(mocks.syncCollectionWatches).not.toHaveBeenCalled();
  });

  it("keeps selection/editor continuity across move and clean rename/delete, but retains dirty conflict", async () => {
    uiStore.selectEntry("entry");
    await editorStore.openFile("old.md");
    const renamed = await handleCollectionDeltaV2({ collectionId: "live", revision: 1, mutationId: "rename", origin: "ui", changes: [{ entryId: "entry", kind: "updated", entry: { id: "entry", parentId: "group", entryType: "file", name: null, path: "renamed.md", sortOrder: 0 } }] });
    expect(renamed.accepted).toBe(true);
    expect(editorStore.state.openFilePath).toBe("renamed.md");
    expect(uiStore.state.selectedEntryId).toBe("entry");
    expect((collectionsStore.state.collections[0].entries[0] as Extract<Collection["entries"][number], { type: "group" }>).children[0]).toEqual({ type: "file", id: "entry", path: "renamed.md" });

    const deleted = await handleCollectionDeltaV2({ collectionId: "live", revision: 2, mutationId: "delete", origin: "ui", changes: [{ entryId: "entry", kind: "removed" }] });
    expect(deleted.accepted).toBe(true);
    expect(editorStore.state.openFilePath).toBeNull();
    expect(uiStore.state.selectedEntryId).toBeNull();

    resetNormalizedCachesForTests();
    mocks.getCollections.mockResolvedValue([baseCollection()]);
    await collectionsStore.loadCollections();
    await editorStore.openFile("renamed.md");
    uiStore.selectEntry("entry");
    editorStore.updateContent("dirty draft");
    const conflict = await handleCollectionDeltaV2({ collectionId: "live", revision: 1, mutationId: "delete-dirty", origin: "ui", changes: [{ entryId: "entry", kind: "removed" }] });
    expect(conflict.accepted).toBe(true);
    expect(editorStore.state.openFilePath).toBe("renamed.md");
    expect(editorStore.state.isDirty).toBe(true);
    expect(editorStore.state.error).toContain("external_change_conflict");
  });

  it("does not reload on ordered filesystem feeds, and performs one live snapshot fallback on gaps/overflow", async () => {
    mocks.getCollections.mockClear();
    const normal = await handleFilesystemChangesV2({ collectionId: "live", streamId: "s1", subscriptionEpoch: "e1", sequence: 1, overflow: false, changes: [{ kind: "folder-changed", path: "folder", changedFilePath: "folder/a.md" }] });
    expect(normal.accepted).toBe(true);
    expect(mocks.getCollections).not.toHaveBeenCalled();
    const gap = await handleFilesystemChangesV2({ collectionId: "live", streamId: "s1", subscriptionEpoch: "e1", sequence: 3, overflow: false, changes: [] });
    expect(gap.needsSnapshot).toBe(true);
    expect(mocks.reconcileCollectionSnapshot).toHaveBeenCalledOnce();
    mocks.reconcileCollectionSnapshot.mockClear();
    const overflow = await handleFilesystemChangesV2({ collectionId: "live", streamId: "s2", subscriptionEpoch: "e2", sequence: 1, overflow: true, changes: [] });
    expect(overflow.needsSnapshot).toBe(true);
    expect(mocks.reconcileCollectionSnapshot).toHaveBeenCalledOnce();
  });

  it("installs authoritative snapshot cursor once, rejects stale queued envelopes, and coalesces in-flight fallbacks", async () => {
    let release!: (value: { collection: Collection; revision: number; cursor: { streamId: string; subscriptionEpoch: string; sequence: number } }) => void;
    mocks.reconcileCollectionSnapshot.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = handleCollectionDeltaV2({ collectionId: "live", revision: 3, mutationId: "gap", origin: "watch", changes: [] });
    const second = handleCollectionDeltaV2({ collectionId: "live", revision: 2, mutationId: "queued", origin: "watch", changes: [] });
    expect(mocks.reconcileCollectionSnapshot).toHaveBeenCalledOnce();
    release({ collection: baseCollection(), revision: 5, cursor: { streamId: "new-stream", subscriptionEpoch: "new-epoch", sequence: 0 } });
    await Promise.all([first, second]);
    expect(getNormalizedCacheForTests("live")?.filesystemStreamId).toBe("new-stream");
    expect(getNormalizedCacheForTests("live")?.filesystemCursorTrusted).toBe(true);
    const stale = await handleCollectionDeltaV2({ collectionId: "live", revision: 4, mutationId: "stale", origin: "watch", changes: [] });
    expect(stale.needsSnapshot).toBe(false);
    const oldFeed = await handleFilesystemChangesV2({ collectionId: "live", streamId: "old-stream", subscriptionEpoch: "old-epoch", sequence: 1, overflow: false, changes: [] });
    expect(oldFeed.needsSnapshot).toBe(false);
    const nextFeed = await handleFilesystemChangesV2({ collectionId: "live", streamId: "new-stream", subscriptionEpoch: "new-epoch", sequence: 1, overflow: false, changes: [] });
    expect(nextFeed.accepted).toBe(true);
  });
});
