import { editorIpcAdapter } from "./infrastructure/ipc";

export const readFile = editorIpcAdapter.readFile;
export const readFolderRefSnapshot = editorIpcAdapter.readFolderRefSnapshot;
export const writeFile = editorIpcAdapter.writeFile;
export const createFile = editorIpcAdapter.createFile;
