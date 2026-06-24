import { createStore } from "solid-js/store";
import * as api from "../lib/tauri";
import { EditorMode, WikilinkFragment } from "../types";
import { uiStore } from "./ui";

interface EditorState {
  openFilePath: string | null;
  openFileContent: string;
  currentContent: string;
  isDirty: boolean;
  mode: EditorMode;
  isSaving: boolean;
  isReadOnly: boolean;
  error: string | null;
  pendingNavigation: WikilinkFragment | null;
}

const [state, setState] = createStore<EditorState>({
  openFilePath: null,
  openFileContent: "",
  currentContent: "",
  isDirty: false,
  mode: "edit-render",
  isSaving: false,
  isReadOnly: false,
  error: null,
  pendingNavigation: null,
});

export const editorStore = {
  state,

  async openFile(path: string, readOnly: boolean = false) {
    setState("error", null);
    try {
      const content = await api.readFile(path);
      setState({
        openFilePath: path,
        openFileContent: content,
        currentContent: content,
        isDirty: false,
        isReadOnly: readOnly,
        mode: readOnly ? "view" : "edit-render",
      });
    } catch (err: unknown) {
      setState("error", String(err) || "Failed to read file");
    }
  },

  async saveFile() {
    const path = state.openFilePath;
    if (!path || state.isReadOnly || !state.isDirty || state.isSaving) return;

    setState("isSaving", true);
    setState("error", null);
    try {
      await api.writeFile(path, state.currentContent);
      setState({
        openFileContent: state.currentContent,
        isDirty: false,
      });
    } catch (err: unknown) {
      setState("error", String(err) || "Failed to save file");
    } finally {
      setState("isSaving", false);
    }
  },

  updateContent(content: string) {
    if (state.isReadOnly) return;
    setState({
      currentContent: content,
      isDirty: content !== state.openFileContent,
    });
  },

  setMode(mode: EditorMode) {
    if (state.isReadOnly && mode !== "view") {
      // Read-only files must stay in view mode
      return;
    }
    setState("mode", mode);
  },

  closeFile() {
    setState({
      openFilePath: null,
      openFileContent: "",
      currentContent: "",
      isDirty: false,
      isReadOnly: false,
      mode: "edit-render",
      isSaving: false,
      error: null,
      pendingNavigation: null,
    });
    uiStore.selectEntry(null);
  },

  navigateTo(fragment: WikilinkFragment) {
    setState("pendingNavigation", fragment);
  },

  clearPendingNavigation() {
    setState("pendingNavigation", null);
  },

  get currentFileName(): string | null {
    const path = state.openFilePath;
    if (!path) return null;
    const basename = path.split(/[/\\]/).pop() || "";
    return basename.replace(/\.md$/i, "");
  }
};
