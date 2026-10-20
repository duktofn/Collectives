import { settingsIpcAdapter } from "./infrastructure/ipc";

export const loadSettings = settingsIpcAdapter.loadSettings;
export const saveSettings = settingsIpcAdapter.saveSettings;
export const importFont = settingsIpcAdapter.importFont;
export const deleteFont = settingsIpcAdapter.deleteFont;
export const getFontsDir = settingsIpcAdapter.getFontsDir;
export const exportTheme = settingsIpcAdapter.exportTheme;
export const importTheme = settingsIpcAdapter.importTheme;

export function isSettingsRecoveryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /^settings_(?:read_error|invalid_file|future_version|storage_unavailable):/.test(message);
}
