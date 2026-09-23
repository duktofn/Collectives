import { settingsIpcAdapter } from "./infrastructure/ipc";

export const loadSettings = settingsIpcAdapter.loadSettings;
export const saveSettings = settingsIpcAdapter.saveSettings;
export const importFont = settingsIpcAdapter.importFont;
export const deleteFont = settingsIpcAdapter.deleteFont;
export const getFontsDir = settingsIpcAdapter.getFontsDir;
export const exportTheme = settingsIpcAdapter.exportTheme;
export const importTheme = settingsIpcAdapter.importTheme;
