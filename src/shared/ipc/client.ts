import { invoke } from "@tauri-apps/api/core";
import { Collection, Entry, FsEntry, BrokenEntry, Settings, ResolveCandidate, ZipConflict, CustomFont } from "../../types";

export type FileKind = "markdown" | "text-source";
export type LineEnding = "LF" | "CRLF" | "mixed" | "none";
export interface FileSnapshot {
  content: string;
  versionToken: string;
  fileKind?: FileKind;
  hadUtf8Bom?: boolean;
  lineEnding?: LineEnding;
  byteSize?: number;
}
export type MetadataMutationOperation =
  | { kind: "addEntry"; parentPath: number[]; entry: Entry }
  | { kind: "removeEntry"; entryId: string }
  | { kind: "moveEntry"; entryId: string; parentPath: number[]; newIndex: number }
  | { kind: "renameGroup"; groupId: string; name: string }
  | { kind: "relinkEntry"; entryId: string; path: string }
  | { kind: "deleteGroupAndPromote"; groupId: string };
export interface MetadataMutationRequest { collectionId: string; expectedRevision: number; mutationId: string; operation: MetadataMutationOperation }
export interface MetadataMutationResult { collectionId: string; revision: number; mutationId: string; changes: unknown; idempotentReplay: boolean; metrics: { changedEntryRows: number; changedLinkRows: number; queryCount: number; fullRebuild: boolean } }
export interface MigrationStatus { mode: string; schemaVersion: number; sourceDigest: string; targetDigest: string; firstCanonicalMutation: boolean }
export interface WatchSpec { path: string; entryId: string; recursive: boolean }
export interface WatchCursor { streamId: string; subscriptionEpoch: string; sequence: number }
export interface MetadataSnapshot { collection: Collection; revision: number; cursor: WatchCursor }

type EmptyArgs = undefined;

export interface CommandMap {
  get_collections: { args: EmptyArgs; result: Collection[] };
  create_collection: { args: { name: string }; result: Collection };
  update_collection: { args: { collection: Collection }; result: void };
  delete_collection: { args: { id: string }; result: void };
  load_settings: { args: EmptyArgs; result: Settings };
  save_settings: { args: { settings: Settings }; result: void };
  read_folder_children: { args: { path: string }; result: FsEntry[] };
  add_entry: { args: { collectionId: string; parentPath: number[]; entry: Entry }; result: void };
  remove_entry: { args: { collectionId: string; entryId: string }; result: Entry };
  delete_group_and_promote: { args: { collectionId: string; groupId: string }; result: void };
  move_entry: { args: { collectionId: string; entryId: string; newParentPath: number[]; newIndex: number }; result: void };
  create_group: { args: { collectionId: string; name: string; parentPath: number[] }; result: Entry };
  rename_group: { args: { collectionId: string; groupId: string; newName: string }; result: void };
  add_file_entries: { args: { collectionId: string; paths: string[] }; result: Entry[] };
  add_folder_ref: { args: { collectionId: string; path: string }; result: Entry };
  validate_entries: { args: { collectionId: string }; result: BrokenEntry[] };
  read_file: { args: { path: string }; result: FileSnapshot | string };
  read_folderref_snapshot: { args: { rootPath: string; childPath: string }; result: FileSnapshot };
  write_file: { args: { path: string; content: string; expectedToken?: string }; result: void };
  resolve_wikilink: { args: { collectionId: string; noteName: string }; result: ResolveCandidate | null };
  search_link_index: { args: { collectionId: string; query: string; limit?: number }; result: ResolveCandidate[] };
  import_folder: { args: { path: string; name: string }; result: Collection };
  export_collection_to_folder: { args: { collectionId: string; destPath: string }; result: void };
  export_collection_to_zip: { args: { collectionId: string; destZipPath: string }; result: void };
  check_zip_conflicts: { args: { zipPath: string; destFolder: string }; result: ZipConflict[] };
  import_zip: { args: { zipPath: string; destFolder: string; resolutions: Record<string, string> }; result: Collection };
  import_font: { args: { sourcePath: string; familyName: string; weight: string; style: string }; result: CustomFont };
  delete_font: { args: { fileName: string }; result: void };
  get_fonts_dir: { args: EmptyArgs; result: string };
  export_theme: { args: { settings: Settings; destPath: string }; result: void };
  import_theme: { args: { themePath: string }; result: Settings };
  watch_entry: { args: { path: string; entryId: string }; result: void };
  unwatch_entry: { args: { path: string }; result: void };
  watch_folder: { args: { path: string; entryId: string }; result: void };
  unwatch_folder: { args: { path: string }; result: void };
  clear_watches: { args: EmptyArgs; result: void };
  initialize_identity_cache: { args: { collectionId: string }; result: void };
  detect_moved_entry: { args: { collectionId: string; entryId: string; oldPath: string }; result: string | null };
  apply_collection_mutation_v2: { args: { request: MetadataMutationRequest }; result: MetadataMutationResult };
  migration_status: { args: EmptyArgs; result: MigrationStatus };
  migration_retry: { args: EmptyArgs; result: MigrationStatus };
  sync_collection_watches: { args: { collectionId: string; specs: WatchSpec[] }; result: WatchCursor };
  reconcile_collection_snapshot: { args: { collectionId: string; specs: WatchSpec[] }; result: MetadataSnapshot };
}

export type CommandName = keyof CommandMap;
export type CommandArgs<K extends CommandName> = CommandMap[K]["args"];
export type CommandResult<K extends CommandName> = CommandMap[K]["result"];

export function invokeCommand<K extends CommandName>(command: K, args: CommandArgs<K>): Promise<CommandResult<K>>;
export function invokeCommand<K extends CommandName>(command: K): Promise<CommandResult<K>>;
export function invokeCommand<K extends CommandName>(command: K, args?: CommandArgs<K>): Promise<CommandResult<K>> {
  return (args === undefined ? invoke<CommandResult<K>>(command) : invoke<CommandResult<K>>(command, args)) as Promise<CommandResult<K>>;
}
