import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

export function getCurrentAppWindow() {
  return getCurrentWebviewWindow();
}
