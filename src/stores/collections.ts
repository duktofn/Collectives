import { createStore } from "solid-js/store";
import { createMemo } from "solid-js";
import { Collection, BrokenEntry, Entry } from "../types";
import * as api from "../lib/tauri";

interface CollectionsState {
  collections: Collection[];
  activeCollectionId: string | null;
  loading: boolean;
  error: string | null;
  brokenEntries: BrokenEntry[];
}

const [state, setState] = createStore<CollectionsState>({
  collections: [],
  activeCollectionId: null,
  loading: false,
  error: null,
  brokenEntries: [],
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
      setState("activeCollectionId", newCol.id);
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
      }
    } catch (err: unknown) {
      setState("error", String(err) || "Failed to delete collection");
    }
  },
  
  async addFiles(paths: string[]) {
    const activeId = state.activeCollectionId;
    if (!activeId) return;
    try {
      await api.addFileEntries(activeId, paths);
      await this.reloadActiveCollection();
      await this.validateActiveCollection();
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
    } catch (err: unknown) {
      setState("error", String(err) || "Failed to create group");
    }
  },
  
  async renameGroup(groupId: string, newName: string) {
    const activeId = state.activeCollectionId;
    if (!activeId) return;
    try {
      await api.renameGroup(activeId, groupId, newName);
      await this.reloadActiveCollection();
    } catch (err: unknown) {
      setState("error", String(err) || "Failed to rename group");
    }
  },
  
  async removeEntry(entryId: string) {
    const activeId = state.activeCollectionId;
    if (!activeId) return;
    try {
      await api.removeEntry(activeId, entryId);
      await this.reloadActiveCollection();
      await this.validateActiveCollection();
    } catch (err: unknown) {
      setState("error", String(err) || "Failed to remove entry");
    }
  },
  
  async moveEntry(entryId: string, newParentPath: number[], newIndex: number) {
    const activeId = state.activeCollectionId;
    if (!activeId) return;
    try {
      await api.moveEntry(activeId, entryId, newParentPath, newIndex);
      await this.reloadActiveCollection();
    } catch (err: unknown) {
      setState("error", String(err) || "Failed to move entry");
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
      }
    } catch (err: unknown) {
      setState("error", String(err) || "Failed to relink entry");
    }
  },
  
  async validateActiveCollection() {
    const activeId = state.activeCollectionId;
    if (!activeId) return;
    try {
      const broken = await api.validateEntries(activeId);
      setState("brokenEntries", broken);
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
    } catch (err) {
      console.error("Failed to reload collection", err);
    }
  }
};
