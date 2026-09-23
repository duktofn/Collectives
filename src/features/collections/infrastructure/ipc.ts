import { invokeCommand } from "../../../shared/ipc/client";
import { Collection, Entry } from "../../../types";
import { MetadataMutationRequest } from "../../../shared/ipc/client";

export const collectionsIpcAdapter = {
  getCollections: () => invokeCommand("get_collections"),
  createCollection: (name: string) => invokeCommand("create_collection", { name }),
  updateCollection: (collection: Collection) => invokeCommand("update_collection", { collection }),
  deleteCollection: (id: string) => invokeCommand("delete_collection", { id }),
  addEntry: (collectionId: string, parentPath: number[], entry: Entry) => invokeCommand("add_entry", { collectionId, parentPath, entry }),
  removeEntry: (collectionId: string, entryId: string) => invokeCommand("remove_entry", { collectionId, entryId }),
  deleteGroupAndPromote: (collectionId: string, groupId: string) => invokeCommand("delete_group_and_promote", { collectionId, groupId }),
  moveEntry: (collectionId: string, entryId: string, newParentPath: number[], newIndex: number) => invokeCommand("move_entry", { collectionId, entryId, newParentPath, newIndex }),
  createGroup: (collectionId: string, name: string, parentPath: number[]) => invokeCommand("create_group", { collectionId, name, parentPath }),
  renameGroup: (collectionId: string, groupId: string, newName: string) => invokeCommand("rename_group", { collectionId, groupId, newName }),
  addFileEntries: (collectionId: string, paths: string[]) => invokeCommand("add_file_entries", { collectionId, paths }),
  addFolderRef: (collectionId: string, path: string) => invokeCommand("add_folder_ref", { collectionId, path }),
  validateEntries: (collectionId: string) => invokeCommand("validate_entries", { collectionId }),
  initializeIdentityCache: (collectionId: string) => invokeCommand("initialize_identity_cache", { collectionId }),
  detectMovedEntry: (collectionId: string, entryId: string, oldPath: string) => invokeCommand("detect_moved_entry", { collectionId, entryId, oldPath }),
  applyCollectionMutationV2: (request: MetadataMutationRequest) => invokeCommand("apply_collection_mutation_v2", { request }),
  migrationStatus: () => invokeCommand("migration_status"),
  migrationRetry: () => invokeCommand("migration_retry"),
  reconcileCollectionSnapshot: (collectionId: string, specs: Array<{ path: string; entryId: string; recursive: boolean }>) => invokeCommand("reconcile_collection_snapshot", { collectionId, specs }),
};
