import { createStore } from "solid-js/store";
import { createMemo } from "solid-js";
import { Collection, BrokenEntry, Entry } from "../types";
import * as collectionsApi from "../features/collections";
import * as archiveApi from "../features/archive";
import * as filesystemApi from "../features/filesystem";
import { listenEvent } from "../shared/ipc/events";
import { editorStore } from "./editor";
import { uiStore } from "./ui";
import { clearWikilinkCache } from "../lib/cm-extensions/wikilink-decoration";
import { applyCollectionDelta, applyFilesystemFeed, deriveMetadataDeltas, installMetadataSnapshot, materializeCollection, replaceMetadataSnapshot, type MetadataCacheState } from "../features/collections/metadataCache";

const normalizedCaches = new Map<string, MetadataCacheState>();
const reconciliationInFlight = new Map<string, Promise<void>>();

export function resetNormalizedCachesForTests(): void { normalizedCaches.clear(); }
export function getNormalizedCacheForTests(collectionId: string): MetadataCacheState | undefined { return normalizedCaches.get(collectionId); }

interface CollectionsState {
  collections: Collection[];
  activeCollectionId: string | null;
  loading: boolean;
  error: string | null;
  brokenEntries: BrokenEntry[];
  movePrompt: {
    entryId: string;
    oldPath: string;
    newPath: string;
    fileName: string;
  } | null;
}

const [state, setState] = createStore<CollectionsState>({
  collections: [],
  activeCollectionId: null,
  loading: false,
  error: null,
  brokenEntries: [],
  movePrompt: null,
});

const activeCollection = createMemo(() => {
  const id = state.activeCollectionId;
  if (!id) return null;
  return state.collections.find((c) => c.id === id) || null;
});

function watchSpecsForCollection(collection: Collection): Array<{ path: string; entryId: string; recursive: boolean }> {
  const specs: Array<{ path: string; entryId: string; recursive: boolean }> = [];
  const visit = (entries: Entry[]) => entries.forEach((entry) => {
    if (entry.type === "file") specs.push({ path: entry.path, entryId: entry.id, recursive: false });
    else if (entry.type === "folder-ref" && uiStore.isExpanded(entry.id)) specs.push({ path: entry.path, entryId: entry.id, recursive: true });
    else if (entry.type === "group") visit(entry.children);
  });
  visit(collection.entries);
  return specs;
}

async function reconcileCollectionSnapshot(collectionId: string): Promise<void> {
  const existing = reconciliationInFlight.get(collectionId);
  if (existing) return existing;
  const promise = (async () => {
    const currentCollection = state.collections.find((item) => item.id === collectionId);
    if (!currentCollection) return;
    const previous = normalizedCaches.get(collectionId);
    const snapshot = await collectionsApi.reconcileCollectionSnapshot(collectionId, watchSpecsForCollection(currentCollection));
    const installed = installMetadataSnapshot(snapshot.collection, snapshot.revision, snapshot.cursor, previous?.fallbackCount ?? 0);
    normalizedCaches.set(collectionId, installed);
    setState("collections", (items) => items.map((item) => item.id === collectionId ? snapshot.collection : item));
    clearWikilinkCache();
    if (previous) await editorStore.applyMetadataContinuity(deriveMetadataDeltas(previous, installed));
  })().finally(() => { reconciliationInFlight.delete(collectionId); });
  reconciliationInFlight.set(collectionId, promise);
  return promise;
}

export async function handleCollectionDeltaV2(payload: { collectionId: string; revision: number; mutationId: string; changes: unknown; origin: string }): Promise<{ accepted: boolean; needsSnapshot: boolean }> {
  if (reconciliationInFlight.has(payload.collectionId)) { await reconcileCollectionSnapshot(payload.collectionId); return { accepted: false, needsSnapshot: false }; }
  const collection = state.collections.find((item) => item.id === payload.collectionId);
  if (!collection) return { accepted: false, needsSnapshot: false };
  const current = normalizedCaches.get(collection.id) ?? replaceMetadataSnapshot(collection, payload.revision - 1);
  if (current.activeRevision >= payload.revision) return { accepted: false, needsSnapshot: false };
  const applied = applyCollectionDelta(current, payload);
  normalizedCaches.set(collection.id, applied.state);
  if (!applied.accepted) {
    await reconcileCollectionSnapshot(payload.collectionId);
    return { accepted: false, needsSnapshot: true };
  }
  const projected = materializeCollection(applied.state, collection);
  setState("collections", (items) => items.map((item) => item.id === projected.id ? projected : item));
  clearWikilinkCache();
  await editorStore.applyMetadataContinuity(Array.isArray(payload.changes) ? payload.changes : []);
  if (state.activeCollectionId === payload.collectionId) await collectionsStore.watchActiveCollection();
  return { accepted: true, needsSnapshot: false };
}

export async function handleFilesystemChangesV2(payload: { collectionId: string; streamId: string; subscriptionEpoch: string; sequence: number; overflow: boolean; changes: unknown[] }): Promise<{ accepted: boolean; needsSnapshot: boolean }> {
  if (reconciliationInFlight.has(payload.collectionId)) { await reconcileCollectionSnapshot(payload.collectionId); return { accepted: false, needsSnapshot: false }; }
  const collection = state.collections.find((item) => item.id === payload.collectionId);
  if (!collection) return { accepted: false, needsSnapshot: false };
  const current = normalizedCaches.get(collection.id) ?? replaceMetadataSnapshot(collection, 0);
  const applied = applyFilesystemFeed(current, payload);
  normalizedCaches.set(collection.id, applied.state);
  if (!applied.accepted) {
    if (!applied.needsSnapshot) return { accepted: false, needsSnapshot: false };
    await reconcileCollectionSnapshot(payload.collectionId);
    return { accepted: false, needsSnapshot: true };
  }
  for (const change of payload.changes) {
    if (!change || typeof change !== "object") continue;
    const value = change as { kind?: string; path?: string; changedFilePath?: string };
    const changedPath = value.changedFilePath ?? value.path;
    if (changedPath && !editorStore.applyFilesystemConflict(changedPath)) continue;
    if (value.kind === "modified" && value.path === editorStore.state.openFilePath && !editorStore.state.isDirty) await editorStore.openFile(value.path, editorStore.state.isReadOnly);
  }
  return { accepted: true, needsSnapshot: false };
}

export const collectionsStore = {
  state,
  activeCollection,

  getFolderRefWatchCursor(collectionId: string) {
    const cache = normalizedCaches.get(collectionId);
    if (!cache || !cache.filesystemCursorTrusted || !cache.filesystemStreamId || !cache.filesystemSubscriptionEpoch) return null;
    return {
      streamId: cache.filesystemStreamId,
      subscriptionEpoch: cache.filesystemSubscriptionEpoch,
      sequence: cache.filesystemSequence,
    };
  },
  
  async loadCollections() {
    setState("loading", true);
    setState("error", null);
    try {
      const cols = await collectionsApi.getCollections();
      setState("collections", cols);
      for (const collection of cols) normalizedCaches.set(collection.id, replaceMetadataSnapshot(collection, normalizedCaches.get(collection.id)?.activeRevision ?? 0));
    } catch (err: unknown) {
      setState("error", String(err) || "Failed to load collections");
    } finally {
      setState("loading", false);
    }
  },
  
  async openCollection(id: string) {
    if (editorStore.state.openFilePath) {
      const closed = await editorStore.closeFile();
      if (!closed) {
        throw new Error(editorStore.state.error || "Save failed; collection switch blocked");
      }
    }
    setState("activeCollectionId", id);
    localStorage.setItem("lastActiveCollectionId", id);
    clearWikilinkCache();
    await editorStore.selectEntry(null);
    uiStore.reset();
    try {
      await collectionsApi.initializeIdentityCache(id);
      await this.watchActiveCollection();
    } catch (err) {
      console.error("Failed to initialize watcher or identity cache", err);
    }
    await this.validateActiveCollection();
  },
  
  async createCollection(name: string) {
    setState("error", null);
    try {
      const exists = state.collections.some(
        (c) => c.name.toLowerCase() === name.toLowerCase()
      );
      if (exists) {
        throw new Error(`Collection name '${name}' already exists`);
      }
      
      const newCol = await collectionsApi.createCollection(name);
      setState("collections", (cols) => [...cols, newCol]);
      await this.openCollection(newCol.id);
      setState("brokenEntries", []);
      return newCol;
    } catch (err: unknown) {
      const msg = (err as Error).message || "Failed to create collection";
      setState("error", msg);
      throw new Error(msg);
    }
  },
  
  async renameCollection(id: string, newName: string) {
    setState("error", null);
    try {
      const exists = state.collections.some(
        (c) => c.id !== id && c.name.toLowerCase() === newName.toLowerCase()
      );
      if (exists) {
        throw new Error(`Collection name '${newName}' already exists`);
      }
      
      const col = state.collections.find((c) => c.id === id);
      if (!col) throw new Error("Collection not found");
      
      const updated = { ...col, name: newName };
      await collectionsApi.updateCollection(updated);
      
      setState("collections", (c) => c.id === id, "name", newName);
    } catch (err: unknown) {
      const msg = (err as Error).message || "Failed to rename collection";
      setState("error", msg);
      throw new Error(msg);
    }
  },
  
  async deleteCollection(id: string) {
    setState("error", null);
    try {
      await collectionsApi.deleteCollection(id);
      setState("collections", (cols) => cols.filter((c) => c.id !== id));
      if (state.activeCollectionId === id) {
        setState("activeCollectionId", null);
        setState("brokenEntries", []);
        localStorage.removeItem("lastActiveCollectionId");
      }
    } catch (err: unknown) {
      const msg = String(err) || "Failed to delete collection";
      setState("error", msg);
      throw new Error(msg);
    }
  },
  
  async addFiles(paths: string[]) {
    const activeId = state.activeCollectionId;
    if (!activeId) return;
    try {
      await collectionsApi.addFileEntries(activeId, paths);
      await this.reloadActiveCollection();
      await this.validateActiveCollection();
      await this.watchActiveCollection();
    } catch (err: unknown) {
      setState("error", String(err) || "Failed to add files");
    }
  },
  
  async addFolderRef(path: string) {
    const activeId = state.activeCollectionId;
    if (!activeId) return;
    try {
      await collectionsApi.addFolderRef(activeId, path);
      await this.reloadActiveCollection();
      await this.validateActiveCollection();
      await this.watchActiveCollection();
    } catch (err: unknown) {
      setState("error", String(err) || "Failed to add folder");
    }
  },
  
  async createGroup(name: string, parentPath: number[]) {
    const activeId = state.activeCollectionId;
    if (!activeId) return;
    try {
      await collectionsApi.createGroup(activeId, name, parentPath);
      await this.reloadActiveCollection();
      await this.watchActiveCollection();
    } catch (err: unknown) {
      const msg = String(err) || "Failed to create group";
      setState("error", msg);
      throw new Error(msg);
    }
  },
  
  async renameGroup(groupId: string, newName: string) {
    const activeId = state.activeCollectionId;
    if (!activeId) return;
    try {
      await collectionsApi.renameGroup(activeId, groupId, newName);
      await this.reloadActiveCollection();
      await this.watchActiveCollection();
    } catch (err: unknown) {
      const msg = String(err) || "Failed to rename group";
      setState("error", msg);
      throw new Error(msg);
    }
  },
  
  async removeEntry(entryId: string) {
    const activeId = state.activeCollectionId;
    if (!activeId) return;
    try {
      await collectionsApi.removeEntry(activeId, entryId);
      await this.reloadActiveCollection();
      await this.validateActiveCollection();
      await this.watchActiveCollection();
    } catch (err: unknown) {
      const msg = String(err) || "Failed to remove entry";
      setState("error", msg);
      throw new Error(msg);
    }
  },

  async deleteGroupAndPromote(groupId: string) {
    const activeId = state.activeCollectionId;
    if (!activeId) return;
    try {
      await collectionsApi.deleteGroupAndPromote(activeId, groupId);
      await this.reloadActiveCollection();
      await this.validateActiveCollection();
      await this.watchActiveCollection();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setState("error", msg || "Failed to delete group");
      throw err;
    }
  },
  
  async moveEntry(entryId: string, newParentPath: number[], newIndex: number) {
    const activeId = state.activeCollectionId;
    if (!activeId) return;
    try {
      await collectionsApi.moveEntry(activeId, entryId, newParentPath, newIndex);
      await this.reloadActiveCollection();
      await this.watchActiveCollection();
    } catch (err: unknown) {
      const msg = String(err) || "Failed to move entry";
      setState("error", msg);
      throw new Error(msg);
    }
  },

  async relinkEntry(entryId: string, newPath: string) {
    const activeCol = this.activeCollection();
    if (!activeCol) return;
    const activeId = state.activeCollectionId;
    if (!activeId) return;
    try {
      const updatedCol = JSON.parse(JSON.stringify(activeCol)) as Collection;
      const recurse = (entries: Entry[]): boolean => {
        for (const entry of entries) {
          if (entry.id === entryId) {
            if (entry.type === "file" || entry.type === "folder-ref") {
              entry.path = newPath;
              return true;
            }
          }
          if (entry.type === "group") {
            if (recurse(entry.children)) return true;
          }
        }
        return false;
      };

      if (recurse(updatedCol.entries)) {
        await collectionsApi.updateCollection(updatedCol);
        await this.reloadActiveCollection();
        await this.validateActiveCollection();
        await this.watchActiveCollection();
      }
    } catch (err: unknown) {
      setState("error", String(err) || "Failed to relink entry");
    }
  },
  
  async watchActiveCollection() {
    const activeCol = this.activeCollection();
    if (!activeCol) return;
    const activeId = state.activeCollectionId;
    if (!activeId) return;
    try {
      const cursor = await filesystemApi.syncCollectionWatches(activeId, watchSpecsForCollection(activeCol));
      const cache = normalizedCaches.get(activeId);
      if (cache) normalizedCaches.set(activeId, { ...cache, filesystemStreamId: cursor.streamId, filesystemSubscriptionEpoch: cursor.subscriptionEpoch, filesystemSequence: cursor.sequence, filesystemCursorTrusted: true });
    } catch (err) {
      console.error("Failed to set up active collection watches", err);
    }
  },

  clearMovePrompt() {
    setState("movePrompt", null);
  },

  async validateActiveCollection() {
    const activeId = state.activeCollectionId;
    if (!activeId) return;
    try {
      const broken = await collectionsApi.validateEntries(activeId);
      setState("brokenEntries", broken);

      // Run move detection for broken entries
      for (const brokenEntry of broken) {
        if (state.movePrompt?.entryId !== brokenEntry.id) {
      const detectedPath = await collectionsApi.detectMovedEntry(activeId, brokenEntry.id, brokenEntry.path);
          if (detectedPath) {
            setState("movePrompt", {
              entryId: brokenEntry.id,
              oldPath: brokenEntry.path,
              newPath: detectedPath,
              fileName: brokenEntry.path.split(/[/\\]/).pop() || brokenEntry.path,
            });
            break; // Show one prompt at a time
          }
        }
      }
    } catch (err) {
      console.error("Failed to validate entries", err);
    }
  },
  
  async reloadActiveCollection() {
    const activeId = state.activeCollectionId;
    if (!activeId) return;
    try {
      const cols = await collectionsApi.getCollections();
      setState("collections", cols);
      for (const collection of cols) normalizedCaches.set(collection.id, replaceMetadataSnapshot(collection, normalizedCaches.get(collection.id)?.activeRevision ?? 0));
      clearWikilinkCache();
    } catch (err) {
      console.error("Failed to reload collection", err);
    }
  },

  async reloadCollectionSnapshot(collectionId: string, revision?: number) {
    try {
      const cols = await collectionsApi.getCollections();
      setState("collections", cols);
      for (const collection of cols) normalizedCaches.set(collection.id, replaceMetadataSnapshot(collection, collection.id === collectionId && revision !== undefined ? revision : normalizedCaches.get(collection.id)?.activeRevision ?? 0));
      clearWikilinkCache();
    } catch (err) {
      console.error("Failed to reload collection snapshot", err);
    }
  },

  async importFolder(path: string, name: string) {
    setState("error", null);
    try {
      const exists = state.collections.some(
        (c) => c.name.toLowerCase() === name.toLowerCase()
      );
      if (exists) {
        throw new Error(`Collection name '${name}' already exists`);
      }
      const newCol = await archiveApi.importFolder(path, name);
      setState("collections", (cols) => [...cols, newCol]);
      await this.openCollection(newCol.id);
      setState("brokenEntries", []);
      return newCol;
    } catch (err: unknown) {
      const msg = (err as Error).message || "Failed to import folder";
      setState("error", msg);
      throw new Error(msg);
    }
  },

  async importZip(zipPath: string, destFolder: string, resolutions: Record<string, string>) {
    setState("error", null);
    try {
      const newCol = await archiveApi.importZip(zipPath, destFolder, resolutions);
      setState("collections", (cols) => [...cols, newCol]);
      await this.openCollection(newCol.id);
      setState("brokenEntries", []);
      return newCol;
    } catch (err: unknown) {
      const msg = (err as Error).message || "Failed to import zip";
      setState("error", msg);
      throw new Error(msg);
    }
  },

  async exportCollectionToFolder(collectionId: string, destPath: string) {
    setState("error", null);
    try {
      await archiveApi.exportCollectionToFolder(collectionId, destPath);
    } catch (err: unknown) {
      const msg = (err as Error).message || "Failed to export to folder";
      setState("error", msg);
      throw new Error(msg);
    }
  },

  async exportCollectionToZip(collectionId: string, destZipPath: string) {
    setState("error", null);
    try {
      await archiveApi.exportCollectionToZip(collectionId, destZipPath);
    } catch (err: unknown) {
      const msg = (err as Error).message || "Failed to export to zip";
      setState("error", msg);
      throw new Error(msg);
    }
  },

  async initializeListeners() {
    if (typeof window === "undefined" || (window as any).__TAURI_INTERNALS__ === undefined) {
      return () => {};
    }
    
    const unlisten1 = await listenEvent("file-modified", async (event) => {
      const payload = event.payload;
      const openPath = editorStore.state.openFilePath;
      const isDirty = editorStore.state.isDirty;
      if (!editorStore.applyFilesystemConflict(payload.path)) return;
      if (openPath && openPath === payload.path && !isDirty) {
        const prevMode = editorStore.state.mode;
        await editorStore.openFile(payload.path, editorStore.state.isReadOnly);
        if (prevMode !== "view" && !editorStore.state.isReadOnly) {
          editorStore.setMode(prevMode);
        }
      }
    });

    const unlisten2 = await listenEvent("entry-deleted", (event) => {
      const payload = event.payload;
      const exists = state.brokenEntries.some((b) => b.id === payload.entryId);
      if (!exists) {
        const newBroken: BrokenEntry = {
          id: payload.entryId,
          path: payload.path,
          reason: "File not found (deleted outside app)",
        };
        setState("brokenEntries", (prev) => [...prev, newBroken]);
      }
    });

    const unlisten3 = await listenEvent("entry-renamed", async (event) => {
      const payload = event.payload;
      await editorStore.applyMetadataContinuity([{ entryId: payload.entryId, kind: "updated", entry: { path: payload.newPath } }]);
    });

    const unlistenFolderChanged = await listenEvent("folder-changed", async (event) => {
      const payload = event.payload;
      const openPath = editorStore.state.openFilePath;
      const isDirty = editorStore.state.isDirty;
      if (!editorStore.applyFilesystemConflict(payload.changedFilePath)) return;
      if (openPath && openPath === payload.changedFilePath && !isDirty) {
        const prevMode = editorStore.state.mode;
        await editorStore.openFile(payload.changedFilePath, editorStore.state.isReadOnly);
        if (prevMode !== "view" && !editorStore.state.isReadOnly) {
          editorStore.setMode(prevMode);
        }
      }
    });

    const unlistenDelta = await listenEvent("collection-delta-v2", async (event) => { await handleCollectionDeltaV2(event.payload); });

    const unlistenFilesystemV2 = await listenEvent("filesystem-changes-v2", async (event) => { await handleFilesystemChangesV2(event.payload); });

    return () => {
      unlisten1();
      unlisten2();
      unlisten3();
      unlistenFolderChanged();
      unlistenDelta();
      unlistenFilesystemV2();
    };
  }
};

