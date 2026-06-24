import { createStore } from "solid-js/store";
import { createMemo } from "solid-js";
import { Collection, BrokenEntry, Entry } from "../types";
import * as api from "../lib/tauri";
import { listen } from "@tauri-apps/api/event";
import { editorStore } from "./editor";
import { uiStore } from "./ui";
import { clearWikilinkCache } from "../lib/cm-extensions/wikilink-decoration";

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

export const collectionsStore = {
  state,
  activeCollection,
  
  async loadCollections() {
    setState("loading", true);
    setState("error", null);
    try {
      const cols = await api.getCollections();
      setState("collections", cols);
    } catch (err: unknown) {
      setState("error", String(err) || "Failed to load collections");
    } finally {
      setState("loading", false);
    }
  },
  
  async openCollection(id: string) {
    setState("activeCollectionId", id);
    localStorage.setItem("lastActiveCollectionId", id);
    clearWikilinkCache();
    uiStore.selectEntry(null);
    uiStore.reset();
    try {
      await api.initializeIdentityCache(id);
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
      
      const newCol = await api.createCollection(name);
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
      await api.updateCollection(updated);
      
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
      await api.deleteCollection(id);
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
      await api.addFileEntries(activeId, paths);
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
      await api.addFolderRef(activeId, path);
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
      await api.createGroup(activeId, name, parentPath);
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
      await api.renameGroup(activeId, groupId, newName);
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
      await api.removeEntry(activeId, entryId);
      await this.reloadActiveCollection();
      await this.validateActiveCollection();
      await this.watchActiveCollection();
    } catch (err: unknown) {
      const msg = String(err) || "Failed to remove entry";
      setState("error", msg);
      throw new Error(msg);
    }
  },
  
  async moveEntry(entryId: string, newParentPath: number[], newIndex: number) {
    const activeId = state.activeCollectionId;
    if (!activeId) return;
    try {
      await api.moveEntry(activeId, entryId, newParentPath, newIndex);
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
        await api.updateCollection(updatedCol);
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
    try {
      await api.clearWatches();
      
      const recurse = async (entries: Entry[]) => {
        for (const entry of entries) {
          if (entry.type === "file") {
            try {
              await api.watchEntry(entry.path, entry.id);
            } catch (e) {
              console.error("Failed to watch entry", entry.path, e);
            }
          } else if (entry.type === "folder-ref") {
            if (uiStore.isExpanded(entry.id)) {
              try {
                await api.watchFolder(entry.path, entry.id);
              } catch (e) {
                console.error("Failed to watch folder-ref", entry.path, e);
              }
            }
          } else if (entry.type === "group") {
            await recurse(entry.children);
          }
        }
      };
      await recurse(activeCol.entries);
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
      const broken = await api.validateEntries(activeId);
      setState("brokenEntries", broken);

      // Run move detection for broken entries
      for (const brokenEntry of broken) {
        if (state.movePrompt?.entryId !== brokenEntry.id) {
          const detectedPath = await api.detectMovedEntry(activeId, brokenEntry.id, brokenEntry.path);
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
      const cols = await api.getCollections();
      setState("collections", cols);
      clearWikilinkCache();
    } catch (err) {
      console.error("Failed to reload collection", err);
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
      const newCol = await api.importFolder(path, name);
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
      const newCol = await api.importZip(zipPath, destFolder, resolutions);
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
      await api.exportCollectionToFolder(collectionId, destPath);
    } catch (err: unknown) {
      const msg = (err as Error).message || "Failed to export to folder";
      setState("error", msg);
      throw new Error(msg);
    }
  },

  async exportCollectionToZip(collectionId: string, destZipPath: string) {
    setState("error", null);
    try {
      await api.exportCollectionToZip(collectionId, destZipPath);
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
    
    const unlisten1 = await listen<{ entryId: string; path: string }>("file-modified", (event) => {
      const payload = event.payload;
      const openPath = editorStore.state.openFilePath;
      const isDirty = editorStore.state.isDirty;
      if (openPath && openPath === payload.path && !isDirty) {
        editorStore.openFile(payload.path, editorStore.state.isReadOnly);
      }
    });

    const unlisten2 = await listen<{ entryId: string; path: string }>("entry-deleted", (event) => {
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

    const unlisten3 = await listen<{ entryId: string; oldPath: string; newPath: string }>("entry-renamed", async (event) => {
      const payload = event.payload;
      await collectionsStore.relinkEntry(payload.entryId, payload.newPath);
    });

    return () => {
      unlisten1();
      unlisten2();
      unlisten3();
    };
  }
};

