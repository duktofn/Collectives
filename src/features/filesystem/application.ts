import { filesystemIpcAdapter } from "./infrastructure/ipc";

export const readFolderChildren = filesystemIpcAdapter.readFolderChildren;
export const watchEntry = filesystemIpcAdapter.watchEntry;
export const unwatchEntry = filesystemIpcAdapter.unwatchEntry;
export const watchFolder = filesystemIpcAdapter.watchFolder;
export const unwatchFolder = filesystemIpcAdapter.unwatchFolder;
export const clearWatches = filesystemIpcAdapter.clearWatches;
export const syncCollectionWatches = filesystemIpcAdapter.syncCollectionWatches;
