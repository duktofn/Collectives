export interface Collection {
  id: string;
  schemaVersion: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  entries: Entry[];
}

export type Entry =
  | { type: "file"; id: string; path: string }
  | { type: "folder-ref"; id: string; path: string }
  | { type: "group"; id: string; name: string; children: Entry[] };

export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
}

export interface BrokenEntry {
  id: string;
  path: string;
  reason: string;
}

export interface Settings {
  theme: string;
  fontBody?: string;
  fontMono?: string;
  fontScale: number;
}

export type EditorMode = "view" | "edit-source" | "edit-render";

