import { createStore } from "solid-js/store";
import * as api from "../features/editor";
import { EditorMode, WikilinkFragment } from "../types";
import { uiStore } from "./ui";
import { applyFilesystemConflict, applyMetadataContinuity, type MetadataEntryDelta } from "../features/editor/metadataContinuity";
import { classifyFilePath, type FileKind } from "../shared/fileCapabilities.generated";

function formatEditorError(error: unknown): string {
  const safety = api.asSafetyError(error);
  return safety ? `${safety.code}: ${safety.message}` : String(error) || "Editor operation failed";
}

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
  pendingSelection: string | null;
  versionToken: string;
  generation: number;
  revision: number;
  fileKind: FileKind | null;
  lastMarkdownMode: EditorMode;
}

interface SaveSnapshot {
  path: string;
  generation: number;
  revision: number;
  content: string;
  expectedToken?: string;
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
  versionToken: "",
  generation: 0,
  revision: 0,
  pendingSelection: null,
  fileKind: null,
  lastMarkdownMode: "edit-render",
});

let saveDrainPromise: Promise<void> | null = null;
let saveQueue: SaveSnapshot[] = [];
let activeSaveSnapshot: SaveSnapshot | null = null;
let selectionRequest = 0;
let openRequest = 0;

function currentSaveSnapshot(): SaveSnapshot | null {
  if (!state.openFilePath || state.isReadOnly || !state.isDirty) return null;
  return {
    path: state.openFilePath,
    generation: state.generation,
    revision: state.revision,
    content: state.currentContent,
    expectedToken: state.versionToken || undefined,
  };
}

function sameSnapshot(left: SaveSnapshot, right: SaveSnapshot): boolean {
  return left.path === right.path
    && left.generation === right.generation
    && left.revision === right.revision;
}

function enqueueSnapshot(snapshot: SaveSnapshot): void {
  if (activeSaveSnapshot && sameSnapshot(activeSaveSnapshot, snapshot)) return;
  const existing = saveQueue.find((queued) => sameSnapshot(queued, snapshot));
  if (!existing) saveQueue.push(snapshot);
}

async function drainSaveQueue(): Promise<void> {
  let lastPersistedToken: string | undefined;
  while (saveQueue.length > 0) {
    const snapshot = saveQueue.shift() as SaveSnapshot;
    activeSaveSnapshot = snapshot;
    const writeSnapshot: SaveSnapshot = lastPersistedToken && snapshot.path === state.openFilePath
      ? { ...snapshot, expectedToken: lastPersistedToken }
      : { ...snapshot };
    try {
      await api.writeFile(writeSnapshot.path, writeSnapshot.content, writeSnapshot.expectedToken);
      const rawSnapshot = await api.readFile(writeSnapshot.path);
      const persisted = typeof rawSnapshot === "string"
        ? { content: rawSnapshot, versionToken: "" }
        : rawSnapshot;
      lastPersistedToken = persisted.versionToken;
      if (
        writeSnapshot.generation === state.generation
        && writeSnapshot.path === state.openFilePath
        && writeSnapshot.revision === state.revision
        && state.currentContent === writeSnapshot.content
      ) {
        setState({
          openFileContent: writeSnapshot.content,
          isDirty: false,
          versionToken: persisted.versionToken,
        });
      } else if (
        writeSnapshot.generation === state.generation
        && writeSnapshot.path === state.openFilePath
      ) {
        setState("versionToken", persisted.versionToken);
      }
    } catch (err: unknown) {
      const latest = currentSaveSnapshot();
      if (latest && !saveQueue.some((queued) => sameSnapshot(queued, latest))) {
        saveQueue.unshift(latest);
      }
      setState("error", formatEditorError(err));
      throw err;
    } finally {
      activeSaveSnapshot = null;
    }
  }
}

export const editorStore = {
  state,

  async applyMetadataContinuity(changes: unknown[]): Promise<boolean> {
    const deltas = changes.filter((change): change is MetadataEntryDelta => {
      if (!change || typeof change !== "object") return false;
      const value = change as Record<string, unknown>;
      return typeof value.entryId === "string" && (value.kind === "added" || value.kind === "updated" || value.kind === "removed");
    });
    const next = applyMetadataContinuity({ selectedEntryId: uiStore.state.selectedEntryId, openPath: state.openFilePath, dirty: state.isDirty, externalConflict: false }, deltas);
    if (next.externalConflict) {
      setState("error", "external_change_conflict: metadata changed while a local draft is open; use Reload and discard local draft or retry");
      return false;
    }
    if (next.openPath !== state.openFilePath && next.openPath && !state.isDirty) setState("openFilePath", next.openPath);
    if (next.selectedEntryId === null && uiStore.state.selectedEntryId !== null) return this.closeFile();
    return true;
  },

  applyFilesystemConflict(path: string): boolean {
    const next = applyFilesystemConflict({ selectedEntryId: uiStore.state.selectedEntryId, openPath: state.openFilePath, dirty: state.isDirty, externalConflict: false }, path);
    if (next.externalConflict) {
      setState("error", "external_change_conflict: file changed outside the app; use Reload and discard local draft or retry");
      return false;
    }
    return true;
  },

  async openFile(path: string, readOnly: boolean = false) {
    const request = ++openRequest;
    if (state.openFilePath && state.isDirty && !state.isReadOnly) {
      try {
        await this.saveFile();
      } catch (err) {
        console.error("Failed to auto-save file before switching:", err);
        return;
      }
    }
    if (request !== openRequest) return;
    const generation = state.generation + 1;
    setState("generation", generation);
    setState("error", null);
    try {
      const rawSnapshot = await api.readFile(path);
      const snapshot = typeof rawSnapshot === "string" ? { content: rawSnapshot, versionToken: "", fileKind: classifyFilePath(path) } : rawSnapshot;
      if (generation !== state.generation || request !== openRequest) return;
      setState({
        openFilePath: path,
        openFileContent: snapshot.content,
        currentContent: snapshot.content,
        isDirty: false,
        isReadOnly: readOnly,
        mode: readOnly ? "view" : (snapshot.fileKind ?? classifyFilePath(path)) === "text-source" ? "edit-source" : state.lastMarkdownMode,
        versionToken: snapshot.versionToken,
        revision: 0,
        fileKind: snapshot.fileKind ?? classifyFilePath(path),
      });
    } catch (err: unknown) {
      setState("error", formatEditorError(err));
      throw err;
    }
  },

  async saveFile() {
    const snapshot = currentSaveSnapshot();
    if (!snapshot) return;
    enqueueSnapshot(snapshot);
    if (saveDrainPromise) return saveDrainPromise;

    setState("isSaving", true);
    setState("error", null);
    const drain = drainSaveQueue();
    saveDrainPromise = drain;
    try {
      await drain;
    } finally {
      setState("isSaving", false);
      if (saveDrainPromise === drain) saveDrainPromise = null;
    }
  },

  async flushPendingSave(): Promise<boolean> {
    if (!state.isDirty || state.isReadOnly) return true;
    try {
      await this.saveFile();
      return state.error === null && !state.isDirty;
    } catch {
      return false;
    }
  },

  beginFolderRefSnapshot(): number {
    const generation = state.generation + 1;
    setState({
      openFilePath: null,
      openFileContent: "",
      currentContent: "",
      isDirty: false,
      isReadOnly: false,
      isSaving: false,
      error: null,
      pendingNavigation: null,
      pendingSelection: null,
      versionToken: "",
      generation,
      revision: 0,
      fileKind: null,
    });
    saveQueue = [];
    return generation;
  },

  commitFolderRefSnapshot(
    path: string,
    snapshot: { content: string; versionToken: string; fileKind?: FileKind },
    generation: number,
    readOnly = false,
  ): boolean {
    if (generation !== state.generation || uiStore.state.selectedEntryId !== path) return false;
    setState({
      openFilePath: path,
      openFileContent: snapshot.content,
      currentContent: snapshot.content,
      isDirty: false,
      isReadOnly: readOnly,
      mode: readOnly ? "view" : (snapshot.fileKind ?? classifyFilePath(path)) === "text-source" ? "edit-source" : state.lastMarkdownMode,
      isSaving: false,
      error: null,
      pendingNavigation: null,
      pendingSelection: null,
      versionToken: snapshot.versionToken,
      revision: 0,
      fileKind: snapshot.fileKind ?? classifyFilePath(path),
    });
    return true;
  },

  updateContent(content: string) {
    if (state.isReadOnly) return;
    setState({
      currentContent: content,
      isDirty: content !== state.openFileContent,
      revision: state.revision + 1,
    });
  },

  setMode(mode: EditorMode) {
    if (state.fileKind === "text-source" && mode !== "edit-source") return;
    if (state.isReadOnly && mode !== "view") {
      // Read-only files must stay in view mode
      return;
    }
    setState("mode", mode);
    if (state.fileKind !== "text-source") setState("lastMarkdownMode", mode);
  },

  async closeFile(discard: boolean = false): Promise<boolean> {
    selectionRequest += 1;
    if (state.isDirty && !state.isReadOnly && !discard) {
      try { await this.saveFile(); } catch { return false; }
    }
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
      pendingSelection: null,
      versionToken: "",
      generation: state.generation + 1,
      revision: 0,
      fileKind: null,
    });
    uiStore.selectEntry(null);
    saveQueue = [];
    return true;
  },

  async reloadAndDiscard(): Promise<boolean> {
    const path = state.openFilePath;
    if (!path) return true;
    const generation = state.generation;
    const revision = state.revision;
    const request = ++openRequest;
    const isCurrent = () => request === openRequest && generation === state.generation
      && revision === state.revision && path === state.openFilePath;
    // Let an already-started write settle, but never enqueue the draft for reload.
    if (saveDrainPromise) await saveDrainPromise.catch(() => {});
    if (!isCurrent()) return false;
    try {
      const raw = await api.readFile(path);
      if (!isCurrent()) return false;
      const snapshot = typeof raw === "string" ? { content: raw, versionToken: "" } : raw;
      saveQueue = [];
      setState({
        openFileContent: snapshot.content,
        currentContent: snapshot.content,
        versionToken: snapshot.versionToken,
        isDirty: false,
        error: null,
        generation: generation + 1,
        revision: 0,
      });
      return true;
    } catch (error) {
      if (isCurrent()) setState("error", formatEditorError(error));
      return false;
    }
  },

  async selectEntry(id: string | null): Promise<boolean> {
    const request = ++selectionRequest;
    setState("pendingSelection", id);
    if (id !== uiStore.state.selectedEntryId && state.isDirty && !state.isReadOnly) {
      try { await this.saveFile(); } catch {
        if (request === selectionRequest) setState("pendingSelection", null);
        return false;
      }
    }
    if (request !== selectionRequest) return false;
    uiStore.selectEntry(id);
    setState("pendingSelection", null);
    return true;
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
