import { invokeCommand } from "../../../shared/ipc/client";

export const archiveIpcAdapter = {
  importFolder: (path: string, name: string) => invokeCommand("import_folder", { path, name }),
  exportCollectionToFolder: (collectionId: string, destPath: string) => invokeCommand("export_collection_to_folder", { collectionId, destPath }),
  exportCollectionToZip: (collectionId: string, destZipPath: string) => invokeCommand("export_collection_to_zip", { collectionId, destZipPath }),
  checkZipConflicts: (zipPath: string, destFolder: string) => invokeCommand("check_zip_conflicts", { zipPath, destFolder }),
  importZip: (zipPath: string, destFolder: string, resolutions: Record<string, string>) => invokeCommand("import_zip", { zipPath, destFolder, resolutions }),
};
