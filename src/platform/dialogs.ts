import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { FILE_PICKER_EXTENSIONS } from "../shared/fileCapabilities.generated";

export { ask, message };

export async function pickFiles(title: string): Promise<string[] | null> {
  const selected = await open({ multiple: true, title, filters: [{ name: "Supported text files", extensions: [...FILE_PICKER_EXTENSIONS] }] });
  if (Array.isArray(selected)) return selected;
  return selected ? [selected] : null;
}

export async function pickDirectory(title: string): Promise<string | null> {
  const selected = await open({ directory: true, title });
  return typeof selected === "string" ? selected : null;
}

export async function pickZipFile(title: string): Promise<string | null> {
  const selected = await open({ multiple: false, title, filters: [{ name: "ZIP Archives", extensions: ["zip"] }] });
  return typeof selected === "string" ? selected : null;
}

export async function saveZipDialog(title: string): Promise<string | null> {
  return save({ title, defaultPath: "collection.zip", filters: [{ name: "ZIP Archives", extensions: ["zip"] }] });
}

export async function pickThemeFile(title: string): Promise<string | null> {
  const selected = await open({ multiple: false, title, filters: [{ name: "Theme Files", extensions: ["json"] }] });
  return typeof selected === "string" ? selected : null;
}

export async function saveThemeDialog(title: string): Promise<string | null> {
  return save({ title, defaultPath: "theme.json", filters: [{ name: "Theme Files", extensions: ["json"] }] });
}

export async function pickFontFile(title: string): Promise<string | null> {
  const selected = await open({ multiple: false, title, filters: [{ name: "Font Files", extensions: ["ttf", "otf", "woff", "woff2"] }] });
  return typeof selected === "string" ? selected : null;
}
