import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCollections: vi.fn(),
  validateEntries: vi.fn(async (): Promise<Array<{ id: string; path: string; reason: string }>> => []),
  detectMovedEntry: vi.fn(async (): Promise<string | null> => null),
  removeEntry: vi.fn(),
  addEntry: vi.fn(),
  addFileEntries: vi.fn(),
  syncCollectionWatches: vi.fn(async (): Promise<{ streamId: string; subscriptionEpoch: string; sequence: number }> => ({ streamId: "stream", subscriptionEpoch: "epoch", sequence: 0 })),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("../features/collections", () => ({
  getCollections: mocks.getCollections,
  validateEntries: mocks.validateEntries,
  detectMovedEntry: mocks.detectMovedEntry,
  removeEntry: mocks.removeEntry,
  addEntry: mocks.addEntry,
  addFileEntries: mocks.addFileEntries,
  initializeIdentityCache: vi.fn(),
  updateCollection: vi.fn(),
  ...Object.fromEntries(["createCollection", "deleteCollection", "createGroup", "renameGroup", "deleteGroupAndPromote", "moveEntry", "addFolderRef", "applyCollectionMutationV2", "migrationStatus", "migrationRetry", "reconcileCollectionSnapshot"].map((name) => [name, vi.fn()])),
}));
vi.mock("../features/filesystem", () => ({
  syncCollectionWatches: mocks.syncCollectionWatches,
  clearWatches: vi.fn(), watchEntry: vi.fn(), unwatchEntry: vi.fn(), watchFolder: vi.fn(), unwatchFolder: vi.fn(),
}));
vi.mock("../features/archive", () => ({ importFolder: vi.fn(), importZip: vi.fn(), exportCollectionToFolder: vi.fn(), exportCollectionToZip: vi.fn() }));
vi.mock("../features/editor", () => ({ readFile: mocks.readFile, writeFile: mocks.writeFile, asSafetyError: vi.fn(() => null) }));

import { collectionsStore, resetNormalizedCachesForTests } from "./collections";
import { editorStore } from "./editor";
import { uiStore } from "./ui";
import type { Collection } from "../types";

const collection: Collection = {
  id: "new-note-tests",
  schemaVersion: 1,
  name: "Notes",
  createdAt: "",
  updatedAt: "",
  entries: [{ type: "group", id: "group", name: "Research", children: [] }],
};

beforeEach(async () => {
  await editorStore.closeFile(true);
  uiStore.selectEntry(null);
  collectionsStore.clearMovePrompt();
  resetNormalizedCachesForTests();
  mocks.getCollections.mockReset().mockResolvedValue([collection]);
  mocks.validateEntries.mockReset().mockResolvedValue([]);
  mocks.detectMovedEntry.mockReset().mockResolvedValue(null);
  mocks.removeEntry.mockReset();
  mocks.addEntry.mockReset().mockResolvedValue(undefined);
  mocks.addFileEntries.mockReset().mockResolvedValue([]);
  mocks.syncCollectionWatches.mockReset().mockResolvedValue({ streamId: "stream", subscriptionEpoch: "epoch", sequence: 0 });
  mocks.readFile.mockReset().mockResolvedValue({ content: "", versionToken: "token" });
  mocks.writeFile.mockReset().mockResolvedValue({ versionToken: "token" });
  await collectionsStore.loadCollections();
});

describe("new note and moved reference safety", () => {
  it("keeps a moved reference pending when the prompt is deferred", async () => {
    mocks.validateEntries.mockResolvedValue([{ id: "missing-entry", path: "old.md", reason: "missing" }]);
    mocks.detectMovedEntry.mockResolvedValue("new.md");

    await collectionsStore.openCollection(collection.id);
    const prompt = collectionsStore.state.movePrompt;
    expect(prompt?.newPath).toBe("new.md");
    collectionsStore.deferMovePrompt();

    expect(collectionsStore.state.movePrompt).toEqual(prompt);
    expect(collectionsStore.state.movePromptDeferred).toBe(true);
    expect(mocks.removeEntry).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("adds a new note under the selected virtual group while keeping the physical path explicit", async () => {
    await collectionsStore.openCollection(collection.id);
    await collectionsStore.addFiles(["C:/notes/new.md"], "group");

    expect(mocks.addEntry).toHaveBeenCalledWith(
      collection.id,
      [0],
      expect.objectContaining({ type: "file", path: "C:/notes/new.md" }),
    );
    expect(mocks.addFileEntries).not.toHaveBeenCalled();
  });
});

