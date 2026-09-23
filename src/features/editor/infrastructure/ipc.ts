import { invokeCommand } from "../../../shared/ipc/client";

export const editorIpcAdapter = {
  readFile: (path: string) => invokeCommand("read_file", { path }),
  readFolderRefSnapshot: (rootPath: string, childPath: string) => invokeCommand("read_folderref_snapshot", { rootPath, childPath }),
  writeFile: (path: string, content: string, expectedToken?: string) => invokeCommand("write_file", { path, content, expectedToken }),
};
