import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Collection, Entry, FsEntry, BrokenEntry, Settings, ResolveCandidate, ZipConflict } from "../types";

export async function getCollections(): Promise<Collection[]> {
  return invoke<Collection[]>("get_collections");
}

export async function createCollection(name: string): Promise<Collection> {
  return invoke<Collection>("create_collection", { name });
}

export async function updateCollection(collection: Collection): Promise<void> {
  return invoke<void>("update_collection", { collection });
}

export async function deleteCollection(id: string): Promise<void> {
  return invoke<void>("delete_collection", { id });
}

export async function loadSettings(): Promise<Settings> {
  return invoke<Settings>("load_settings");
}

export async function saveSettings(settings: Settings): Promise<void> {
  return invoke<void>("save_settings", { settings });
}

export async function readFolderChildren(path: string): Promise<FsEntry[]> {
  return invoke<FsEntry[]>("read_folder_children", { path });
}

export async function addEntry(collectionId: string, parentPath: number[], entry: Entry): Promise<void> {
  return invoke<void>("add_entry", { collectionId, parentPath, entry });
}

export async function removeEntry(collectionId: string, entryId: string): Promise<Entry> {
  return invoke<Entry>("remove_entry", { collectionId, entryId });
}

export async function moveEntry(
  collectionId: string,
  entryId: string,
  newParentPath: number[],
  newIndex: number
): Promise<void> {
  return invoke<void>("move_entry", { collectionId, entryId, newParentPath, newIndex });
}

export async function createGroup(collectionId: string, name: string, parentPath: number[]): Promise<Entry> {
  return invoke<Entry>("create_group", { collectionId, name, parentPath });
}

export async function renameGroup(collectionId: string, groupId: string, newName: string): Promise<void> {
  return invoke<void>("rename_group", { collectionId, groupId, newName });
}

export async function addFileEntries(collectionId: string, paths: string[]): Promise<Entry[]> {
  return invoke<Entry[]>("add_file_entries", { collectionId, paths });
}

export async function addFolderRef(collectionId: string, path: string): Promise<Entry> {
  return invoke<Entry>("add_folder_ref", { collectionId, path });
}

export async function validateEntries(collectionId: string): Promise<BrokenEntry[]> {
  return invoke<BrokenEntry[]>("validate_entries", { collectionId });
}

// Dialog helper wrappers
export async function pickFiles(title: string): Promise<string[] | null> {
  const selected = await open({
    multiple: true,
    title,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (Array.isArray(selected)) {
    return selected;
  } else if (selected) {
    return [selected];
  }
  return null;
}

export async function pickDirectory(title: string): Promise<string | null> {
  const selected = await open({
    directory: true,
    title,
  });
  return typeof selected === "string" ? selected : null;
}

export async function readFile(path: string): Promise<string> {
  return invoke<string>("read_file", { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  return invoke<void>("write_file", { path, content });
}

export async function resolveWikilink(
  collectionId: string,
  noteName: string
): Promise<ResolveCandidate | null> {
  return invoke<ResolveCandidate | null>("resolve_wikilink", { collectionId, noteName });
}

export async function searchLinkIndex(
  collectionId: string,
  query: string,
  limit?: number
): Promise<ResolveCandidate[]> {
  return invoke<ResolveCandidate[]>("search_link_index", { collectionId, query, limit });
}

export async function importFolder(path: string, name: string): Promise<Collection> {
  return invoke<Collection>("import_folder", { path, name });
}

export async function exportCollectionToFolder(collectionId: string, destPath: string): Promise<void> {
  return invoke<void>("export_collection_to_folder", { collectionId, destPath });
}

export async function exportCollectionToZip(collectionId: string, destZipPath: string): Promise<void> {
  return invoke<void>("export_collection_to_zip", { collectionId, destZipPath });
}

export async function checkZipConflicts(zipPath: string, destFolder: string): Promise<ZipConflict[]> {
  return invoke<ZipConflict[]>("check_zip_conflicts", { zipPath, destFolder });
}

export async function importZip(
  zipPath: string,
  destFolder: string,
  resolutions: Record<string, string>
): Promise<Collection> {
  return invoke<Collection>("import_zip", { zipPath, destFolder, resolutions });
}

export async function pickZipFile(title: string): Promise<string | null> {
  const selected = await open({
    multiple: false,
    title,
    filters: [{ name: "ZIP Archives", extensions: ["zip"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function saveZipDialog(title: string): Promise<string | null> {
  return save({
    title,
    defaultPath: "collection.zip",
    filters: [{ name: "ZIP Archives", extensions: ["zip"] }]
  });
}



