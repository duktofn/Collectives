import { invokeCommand } from "../../../shared/ipc/client";
import type { WatchSpec } from "../../../shared/ipc/client";

export const filesystemIpcAdapter = {
  readFolderChildren: (path: string) => invokeCommand("read_folder_children", { path }),
  watchEntry: (path: string, entryId: string) => invokeCommand("watch_entry", { path, entryId }),
  unwatchEntry: (path: string) => invokeCommand("unwatch_entry", { path }),
  watchFolder: (path: string, entryId: string) => invokeCommand("watch_folder", { path, entryId }),
  unwatchFolder: (path: string) => invokeCommand("unwatch_folder", { path }),
  clearWatches: () => invokeCommand("clear_watches"),
  syncCollectionWatches: (collectionId: string, specs: WatchSpec[]) => invokeCommand("sync_collection_watches", { collectionId, specs }),
};
