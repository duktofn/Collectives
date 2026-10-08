import { invokeCommand } from "../../../shared/ipc/client";
import { Settings } from "../../../types";

export const settingsIpcAdapter = {
  loadSettings: () => invokeCommand("load_settings"),
  saveSettings: (settings: Settings) => invokeCommand("save_settings", { settings }),
  importFont: (sourcePath: string, familyName: string, weight: string, style: string, fontDataBase64?: string, preferredFileName?: string) => invokeCommand("import_font", { sourcePath, familyName, weight, style, fontDataBase64, preferredFileName }),
  deleteFont: (fileName: string) => invokeCommand("delete_font", { fileName }),
  getFontsDir: () => invokeCommand("get_fonts_dir"),
  exportTheme: (settings: Settings, destPath: string) => invokeCommand("export_theme", { settings, destPath }),
  importTheme: (themePath: string) => invokeCommand("import_theme", { themePath }),
};
