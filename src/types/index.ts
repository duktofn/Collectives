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

export interface CustomFont {
  family: string;
  fileName: string;
  weight: string;
  style: string;
}

export interface Settings {
  theme: string;
  fontBody?: string;
  fontMono?: string;
  fontScale: number;
  sizeH1?: number;
  sizeH2?: number;
  sizeH3?: number;
  sizeH4?: number;
  colorH1?: string;
  colorH2?: string;
  colorH3?: string;
  colorH4?: string;
  colorCodeBg?: string;
  colorCodeText?: string;
  colorLink?: string;
  colorLinkHover?: string;
  customFonts?: CustomFont[];
}

export type EditorMode = "view" | "edit-source" | "edit-render";

// Wikilink parse result
export interface WikilinkToken {
  raw: string;                        // nguyên văn "[[...]]"
  noteName: string;                   // tên note (bỏ .md nếu có)
  fragment: WikilinkFragment | null;  // #^blockId hoặc #Heading
}

export interface WikilinkFragment {
  type: "block" | "heading";
  value: string;  // blockId (không có ^) hoặc heading text
}

// Backend resolve result
export interface ResolveCandidate {
  displayName: string;
  entryId: string;
  path: string;
  entryType: string;  // "file" | "folder-ref"
}

export interface ZipConflict {
  entryId: string;
  displayName: string;
  targetPath: string;
}

export type ZipResolution = "overwrite" | "rename" | "skip";



