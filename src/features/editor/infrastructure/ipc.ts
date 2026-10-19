import type { WritePrecondition } from "../../../shared/ipc/client";
import { invokeCommand } from "../../../shared/ipc/client";

export const editorIpcAdapter = {
  readFile: (path: string) => invokeCommand("read_file", { path }),
  readFolderRefSnapshot: (rootPath: string, childPath: string) => invokeCommand("read_folderref_snapshot", { rootPath, childPath }),
  writeFile: (path: string, content: string, precondition: WritePrecondition) => invokeCommand("write_file", { path, content, precondition }),
  createFile: (path: string, content: string) => invokeCommand("create_file", { path, content }),
};
