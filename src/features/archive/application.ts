import { archiveIpcAdapter } from "./infrastructure/ipc";

export const importFolder = archiveIpcAdapter.importFolder;
export const exportCollectionToFolder = archiveIpcAdapter.exportCollectionToFolder;
export const exportCollectionToZip = archiveIpcAdapter.exportCollectionToZip;
export const checkZipConflicts = archiveIpcAdapter.checkZipConflicts;
export const importZip = archiveIpcAdapter.importZip;
