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
  isText?: boolean | null;
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

export interface ImportedThemeFont extends CustomFont {
  base64Data: string;
}

export interface ImportedTheme {
  settings: Settings;
  fonts: ImportedThemeFont[];
}

export interface CodeColors {
  text?: string;
  background?: string;
  keyword?: string;
  modifier?: string;
  type?: string;
  function?: string;
  variable?: string;
  property?: string;
  string?: string;
  number?: string;
  comment?: string;
  annotation?: string;
  macro?: string;
  lineNumber?: string;
  activeLineNumber?: string;
}

export interface ThemeColors {
  background?: string;
  surface?: string;
  border?: string;
  text?: string;
  secondaryText?: string;
  hover?: string;
  active?: string;
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
  colorBody?: string;
  colorAccent?: string;
  codeColors?: CodeColors;
  themeColors?: ThemeColors;
  colorH2?: string;
  colorH3?: string;
  colorH4?: string;
  colorCodeBg?: string;
  colorCodeText?: string;
  colorSelection?: string;
  colorLink?: string;
  colorLinkHover?: string;
  lineHeight?: number;
  customFonts?: CustomFont[];
  sidebarHoverReveal?: boolean;
  noteLayout?: 'centered' | 'wide';
  noteWidth?: number;
  highlightCodeOccurrences?: boolean;
  highlightMarkdownOccurrences?: boolean;
  customThemes?: CustomTheme[];
  activeThemeId?: string;
}

export interface ThemePalette {
  mode: 'dark' | 'light';
  accent: string;
  selection: string;
  note: Record<string, string>;
  code: CodeColors;
  interface: ThemeColors;
}

export interface CustomTheme {
  id: string;
  name: string;
  palette: ThemePalette;
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
  conflictId: string;
  entryId: string;
  displayName: string;
  targetPath: string;
  originMembers: string[];
  allowedResolutions: ZipResolution[];
  kind: string;
}

export type ZipResolution = "overwrite" | "rename" | "skip";



