import { createStore } from "solid-js/store";
import * as api from "../features/editor";
import { EditorMode, WikilinkFragment } from "../types";
import { uiStore } from "./ui";
import { applyMetadataContinuity, type MetadataEntryDelta } from "../features/editor/metadataContinuity";
import { classifyFilePath, type FileKind } from "../shared/fileCapabilities.generated";
import {
  clearPersistedRecoveryDraft,
  makeRecoveryDraftId,
  scheduleRecoveryDraft,
  scheduleRecoveryDraftCapture,
  type RecoveryDraft,
} from "../features/editor/recovery";

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
  conflictKind: "file" | "metadata" | null;
  pendingNavigation: WikilinkFragment | null;
  pendingSearchPosition: { path: string; lineNumber: number; columnUtf16: number } | null;
  pendingSelection: string | null;
  versionToken: string;
  generation: number;
  revision: number;
  recoverySessionId: string;
  recoveryCollectionId: string;
  fileKind: FileKind | null;
  lastMarkdownMode: EditorMode;
}

interface SaveSnapshot {
  path: string;
  generation: number;
  revision: number;
  content: string;
  expectedToken?: string;
  recoverySessionId: string;
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
  conflictKind: null,
  pendingNavigation: null,
  pendingSearchPosition: null,
  versionToken: "",
  generation: 0,
  revision: 0,
  recoverySessionId: "",
  recoveryCollectionId: "",
  pendingSelection: null,
  fileKind: null,
  lastMarkdownMode: "edit-render",
});

let saveDrainPromise: Promise<void> | null = null;
let saveQueue: SaveSnapshot[] = [];
let activeSaveSnapshot: SaveSnapshot | null = null;
let filesystemConflictEpoch = 0;
let selectionRequest = 0;
let openRequest = 0;
let recoveryCollectionId = "";
let currentContentReader: (() => string | null) | null = null;

function getCurrentContent(): string {
  try {
    const live = currentContentReader?.();
    return typeof live === "string" ? live : state.currentContent;
  } catch {
    return state.currentContent;
  }
}

function currentSaveSnapshot(): SaveSnapshot | null {
  if (!state.openFilePath || state.isReadOnly || !state.isDirty) return null;
  return {
    path: state.openFilePath,
    generation: state.generation,
    revision: state.revision,
    content: getCurrentContent(),
    expectedToken: state.versionToken || undefined,
    recoverySessionId: state.recoverySessionId,
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
      const conflictEpochAtStart = filesystemConflictEpoch;
      const receipt = await api.writeFile(writeSnapshot.path, writeSnapshot.content, writeSnapshot.expectedToken);
      // Keep older/mocked adapters safe: retaining the prior token causes a later
      // CAS conflict rather than silently accepting an unverified disk version.
      const persistedVersionToken = receipt?.versionToken ?? writeSnapshot.expectedToken ?? state.versionToken;
      lastPersistedToken = persistedVersionToken;
      if (
        filesystemConflictEpoch !== conflictEpochAtStart &&
        writeSnapshot.generation === state.generation &&
        writeSnapshot.path === state.openFilePath
      ) {
        const rawCurrent = await api.readFile(writeSnapshot.path);
        const currentDisk = typeof rawCurrent === "string"
          ? { content: rawCurrent, versionToken: "" }
          : rawCurrent;
        if (currentDisk.versionToken !== persistedVersionToken) {
          setState({
            openFileContent: currentDisk.content,
            isDirty: getCurrentContent() !== currentDisk.content,
            versionToken: currentDisk.versionToken || persistedVersionToken,
            error: "external_change_conflict: the file changed while the save was completing; the draft was retained",
            conflictKind: "file",
          });
          throw { code: "external_change_conflict", message: "File changed while save was completing" };
        }
        if (state.conflictKind === "file") {
          setState({ error: null, conflictKind: null });
        }
      }
      clearPersistedRecoveryDraft(writeSnapshot.path, writeSnapshot.recoverySessionId, writeSnapshot.revision);
      const currentContent = getCurrentContent();
      if (
        writeSnapshot.generation === state.generation
        && writeSnapshot.path === state.openFilePath
        && writeSnapshot.revision === state.revision
        && currentContent === writeSnapshot.content
      ) {
        const retainedConflict = state.conflictKind === "metadata" ? "metadata" : null;
        setState({
          openFileContent: writeSnapshot.content,
          currentContent: writeSnapshot.content,
          isDirty: false,
          versionToken: persistedVersionToken,
          conflictKind: retainedConflict,
        });
      } else if (
        writeSnapshot.generation === state.generation
        && writeSnapshot.path === state.openFilePath
      ) {
        setState({
          versionToken: persistedVersionToken,
          conflictKind: state.conflictKind === "metadata" ? "metadata" : null,
        });
      }
    } catch (err: unknown) {
      const latest = currentSaveSnapshot();
      if (latest && !saveQueue.some((queued) => sameSnapshot(queued, latest))) {
        saveQueue.unshift(latest);
      }
      setState("error", formatEditorError(err));
      if (api.asSafetyError(err)?.code === "external_change_conflict") setState("conflictKind", "file");
      throw err;
    } finally {
      activeSaveSnapshot = null;
    }
  }
}

export const editorStore = {
  state,

  setRecoveryCollectionId(collectionId: string | null) {
    recoveryCollectionId = collectionId ?? "";
    if (collectionId && state.openFilePath) setState("recoveryCollectionId", collectionId);
  },

  registerCurrentContentReader(reader: () => string): () => void {
    currentContentReader = reader;
    return () => {
      if (currentContentReader === reader) currentContentReader = null;
    };
  },

  getCurrentContent,

  markContentChanged() {
    if (state.isReadOnly) return;
    const revision = state.revision + 1;
    setState({ isDirty: true, revision });
    const collectionId = state.recoveryCollectionId || recoveryCollectionId;
    if (!state.openFilePath || !state.recoverySessionId || !collectionId) return;
    const path = state.openFilePath;
    const sessionId = state.recoverySessionId;
    const entryId = uiStore.state.selectedEntryId || path;
    const metadata = {
      id: makeRecoveryDraftId(collectionId, entryId, path),
      collectionId,
      entryId,
      path,
      baseVersionToken: state.versionToken,
      revision,
      sessionId,
      updatedAt: Date.now(),
    };
    scheduleRecoveryDraftCapture(metadata, () => {
      if (state.openFilePath !== path || state.recoverySessionId !== sessionId) return null;
      return getCurrentContent();
    });
  },

  async applyMetadataContinuity(changes: unknown[]): Promise<boolean> {
    const deltas = changes.filter((change): change is MetadataEntryDelta => {
      if (!change || typeof change !== "object") return false;
      const value = change as Record<string, unknown>;
      return typeof value.entryId === "string" && (value.kind === "added" || value.kind === "updated" || value.kind === "removed");
    });
    const next = applyMetadataContinuity({ selectedEntryId: uiStore.state.selectedEntryId, openPath: state.openFilePath, dirty: state.isDirty, externalConflict: false }, deltas);
    if (next.externalConflict) {
      setState("error", "metadata_conflict: collection metadata changed while a local draft is open; reload before switching entries");
      setState("conflictKind", "metadata");
      return false;
    }
    if (next.openPath !== state.openFilePath && next.openPath && !state.isDirty) setState("openFilePath", next.openPath);
    if (next.selectedEntryId === null && uiStore.state.selectedEntryId !== null) return this.closeFile();
    return true;
  },

  async handleFilesystemChange(path: string): Promise<boolean> {
    if (path !== state.openFilePath) return true;
    const generation = state.generation;
    let rawSnapshot: Awaited<ReturnType<typeof api.readFile>>;
    try {
      rawSnapshot = await api.readFile(path);
    } catch (error) {
      if (generation !== state.generation || path !== state.openFilePath) return false;
      if (state.isDirty || state.isSaving) {
        if (state.isSaving) filesystemConflictEpoch += 1;
        setState("error", "external_change_conflict: file changed outside the app; the current version could not be read, so the draft was retained");
        setState("conflictKind", "file");
      } else {
        setState("error", formatEditorError(error));
      }
      return false;
    }
    if (generation !== state.generation || path !== state.openFilePath) return false;
    const snapshot = typeof rawSnapshot === "string"
      ? { content: rawSnapshot, versionToken: "" }
      : rawSnapshot;
    const activeWriteMatches = activeSaveSnapshot?.path === path
      && activeSaveSnapshot.generation === generation
      && activeSaveSnapshot.content === snapshot.content;
    if (activeWriteMatches) return false;
    if (snapshot.versionToken && snapshot.versionToken === state.versionToken) return false;
    if (!snapshot.versionToken && snapshot.content === state.openFileContent && !state.isDirty) return false;
    if (state.isDirty || state.isSaving) {
      if (state.isSaving) filesystemConflictEpoch += 1;
      setState("error", "external_change_conflict: file changed outside the app; use Reload and discard local draft or overwrite the version currently on disk");
      setState("conflictKind", "file");
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
    setState("conflictKind", null);
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
        recoverySessionId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        recoveryCollectionId,
        conflictKind: null,
      });
    } catch (err: unknown) {
      setState("error", formatEditorError(err));
      throw err;
    }
  },

  async saveFile() {
    const snapshot = currentSaveSnapshot();
    if (!snapshot) return;
    if (state.conflictKind) throw new Error(state.error || "Resolve the current conflict before saving");
    enqueueSnapshot(snapshot);
    if (saveDrainPromise) return saveDrainPromise;

    setState("isSaving", true);
    setState("error", null);
    setState("conflictKind", null);
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
      conflictKind: null,
      pendingNavigation: null,
      pendingSearchPosition: null,
      pendingSelection: null,
      versionToken: "",
      generation,
      revision: 0,
      fileKind: null,
      recoverySessionId: "",
      recoveryCollectionId: "",
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
      conflictKind: null,
      pendingNavigation: null,
      pendingSearchPosition: null,
      pendingSelection: null,
      versionToken: snapshot.versionToken,
      revision: 0,
      fileKind: snapshot.fileKind ?? classifyFilePath(path),
      recoverySessionId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      recoveryCollectionId,
    });
    return true;
  },

  updateContent(content: string) {
    if (state.isReadOnly) return;
    const revision = state.revision + 1;
    setState({
      currentContent: content,
      isDirty: content !== state.openFileContent,
      revision,
    });
    const collectionId = state.recoveryCollectionId || recoveryCollectionId;
    if (!state.openFilePath || !state.recoverySessionId || !collectionId) return;
    if (content === state.openFileContent) {
      clearPersistedRecoveryDraft(state.openFilePath, state.recoverySessionId, Number.MAX_SAFE_INTEGER);
      return;
    }
    const entryId = uiStore.state.selectedEntryId || state.openFilePath;
    scheduleRecoveryDraft({
      id: makeRecoveryDraftId(collectionId, entryId, state.openFilePath),
      collectionId,
      entryId,
      path: state.openFilePath,
      baseVersionToken: state.versionToken,
      content,
      revision,
      sessionId: state.recoverySessionId,
      updatedAt: Date.now(),
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
    const closingPath = state.openFilePath;
    const closingRecoverySession = state.recoverySessionId;
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
      conflictKind: null,
      pendingNavigation: null,
      pendingSearchPosition: null,
      pendingSelection: null,
      versionToken: "",
      generation: state.generation + 1,
      revision: 0,
      fileKind: null,
      recoverySessionId: "",
      recoveryCollectionId: "",
    });
    if (discard && closingPath && closingRecoverySession) {
      clearPersistedRecoveryDraft(closingPath, closingRecoverySession, Number.MAX_SAFE_INTEGER);
    }
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
      clearPersistedRecoveryDraft(path, state.recoverySessionId, Number.MAX_SAFE_INTEGER);
      setState({
        openFileContent: snapshot.content,
        currentContent: snapshot.content,
        versionToken: snapshot.versionToken,
        isDirty: false,
        error: null,
        conflictKind: null,
        generation: generation + 1,
        revision: 0,
        recoverySessionId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        recoveryCollectionId: state.recoveryCollectionId || recoveryCollectionId,
      });
      return true;
    } catch (error) {
      if (isCurrent()) setState("error", formatEditorError(error));
      return false;
    }
  },

  async overwriteExternalVersion(comparedDiskToken: string): Promise<boolean> {
    const path = state.openFilePath;
    if (!path || !state.isDirty || state.isReadOnly || state.isSaving || state.conflictKind !== "file") return false;
    const generation = state.generation;
    const revision = state.revision;
    setState("isSaving", true);
    try {
      const raw = await api.readFile(path);
      if (path !== state.openFilePath || generation !== state.generation || revision !== state.revision) return false;
      const snapshot = typeof raw === "string" ? { content: raw, versionToken: "" } : raw;
      if (snapshot.versionToken !== comparedDiskToken) {
        setState("error", "external_change_conflict: the file changed again after comparison; compare the current versions before overwriting");
        return false;
      }
      if (!snapshot.versionToken) {
        setState("error", "external_change_conflict: the current disk version has no version token; the draft was retained");
        return false;
      }
      saveQueue = saveQueue.filter((queued) => queued.path !== path || queued.generation !== generation);
      setState({ versionToken: snapshot.versionToken, error: null, conflictKind: null });
      await this.saveFile();
      return !state.isDirty && state.error === null;
    } catch (error) {
      setState("error", formatEditorError(error));
      if (api.asSafetyError(error)?.code === "external_change_conflict") setState("conflictKind", "file");
      return false;
    } finally {
      if (!saveDrainPromise) setState("isSaving", false);
    }
  },

  async saveDraftCopy(path: string): Promise<boolean> {
    const content = getCurrentContent();
    try {
      await api.createFile(path, content);
      return true;
    } catch (error) {
      setState("error", formatEditorError(error));
      return false;
    }
  },

  async restoreRecoveredDraft(draft: RecoveryDraft, selectionId = draft.path): Promise<boolean> {
    const request = ++openRequest;
    let disk: { content: string; versionToken: string; fileKind?: FileKind } | null = null;
    let readError: unknown = null;
    try {
      const raw = await api.readFile(draft.path);
      disk = typeof raw === "string"
        ? { content: raw, versionToken: "", fileKind: classifyFilePath(draft.path) ?? "markdown" }
        : raw;
    } catch (error) {
      readError = error;
    }
    if (request !== openRequest) return false;
    const generation = state.generation + 1;
    const conflict = !disk || !draft.baseVersionToken || disk.versionToken !== draft.baseVersionToken;
    const error = !disk
      ? `recovered_file_missing: the original file is unavailable; the recovered draft is preserved. ${formatEditorError(readError)}`
      : conflict
        ? "external_change_conflict: the file changed since this draft was recovered; compare versions or save a copy"
        : null;
    uiStore.selectEntry(selectionId);
    setState({
      openFilePath: draft.path,
      openFileContent: disk?.content ?? "",
      currentContent: draft.content,
      isDirty: draft.content !== (disk?.content ?? ""),
      isReadOnly: false,
      mode: (disk?.fileKind ?? classifyFilePath(draft.path)) === "text-source" ? "edit-source" : "edit-render",
      isSaving: false,
      error,
      conflictKind: conflict ? "file" : null,
      pendingNavigation: null,
      pendingSearchPosition: null,
      pendingSelection: null,
      versionToken: disk?.versionToken ?? "",
      generation,
      revision: draft.revision + 1,
      fileKind: disk?.fileKind ?? classifyFilePath(draft.path),
      recoverySessionId: draft.sessionId,
      recoveryCollectionId: draft.collectionId,
    });
    saveQueue = [];
    if (!conflict) {
      scheduleRecoveryDraft({ ...draft, revision: draft.revision + 1, updatedAt: Date.now() }, 0);
    }
    return true;
  },

  keepEditing() {
    // The disk conflict remains active and blocks writes, while the local draft stays editable.
    setState("error", null);
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

  navigateToPosition(path: string, lineNumber: number, columnUtf16: number) {
    setState("pendingSearchPosition", {
      path,
      lineNumber: Math.max(1, Math.floor(lineNumber)),
      columnUtf16: Math.max(0, Math.floor(columnUtf16)),
    });
  },

  clearPendingSearchPosition() {
    setState("pendingSearchPosition", null);
  },

  get currentFileName(): string | null {
    const path = state.openFilePath;
    if (!path) return null;
    const basename = path.split(/[/\\]/).pop() || "";
    return basename.replace(/\.md$/i, "");
  }
};
