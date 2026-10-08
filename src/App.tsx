import { createSignal, Show, For, createEffect, onMount, onCleanup, lazy } from "solid-js";
import { collectionsStore } from "./stores/collections";
import { uiStore } from "./stores/ui";
import { Dialog } from "./components/common/Dialog";
import { Icon } from "./components/common/Icon";
import { Entry, ZipConflict, Settings, ResolveCandidate } from "./types";
import { editorStore } from "./stores/editor";
import { EditorToolbar } from "./components/editor/EditorToolbar";
import { AppShell } from "./components/shell/AppShell";
import { WorkspaceHeader } from "./components/shell/WorkspaceHeader";
import { ActivityStatus } from "./components/shell/ActivityStatus";
import { EmptyWorkspace } from "./components/shell/EmptyWorkspace";
import { WorkspaceHome } from "./components/shell/WorkspaceHome";
import * as settingsApi from "./features/settings";
import * as archiveApi from "./features/archive";
import * as editorApi from "./features/editor";
import { pickDirectory, pickZipFile, getCurrentAppWindow } from "./platform";
import { FolderRefReadinessNotice } from "./components/common/FolderRefReadinessNotice";
import { applyThemeSettings, registerCustomFonts } from "./lib/themeEngine";
import { cancelFolderRefReadiness, getFolderRefReadiness, resolveFolderRefIntent, retryFolderRefChild, folderRefReadiness } from "./features/filesystem/folderRefReadiness";
import { formatIpcError } from "./shared/ipc/errors";
import { createOperationLeaseRegistry } from "./workflows/operationLease";
import { ArchiveWorkflow, runArchiveOperation } from "./workflows/ArchiveWorkflow";
import { SettingsWorkflow } from "./workflows/SettingsWorkflow";
import { TreeWorkspace } from "./workflows/TreeWorkspace";
import { CollectionWorkspace } from "./workflows/CollectionWorkspace";
import { DocumentWorkspace } from "./workflows/DocumentWorkspace";
import { requestFolderRefChild } from "./features/filesystem/folderRefReadiness";
import { announcementKey, announcer, mountAnnouncer } from "./a11y/announcer";
import { flushPendingRecoveryDraft, listRecoveryDrafts, removeRecoveryDraft, type RecoveryDraft } from "./features/editor/recovery";
import { canNavigateBack, canNavigateForward, cancelHistoryNavigation, peekHistoryTarget, recordNavigation } from "./features/editor/navigationHistory";
import type { ContentSearchResult } from "./shared/ipc/client";
import "./App.css";
import "./styles/workspace-polish.css";

const QuickOpenDialog = lazy(() => import("./components/search/QuickOpenDialog").then((module) => ({ default: module.QuickOpenDialog })));
const ContentSearchDialog = lazy(() => import("./components/search/ContentSearchDialog").then((module) => ({ default: module.ContentSearchDialog })));
const RecoveryDialog = lazy(() => import("./components/editor/RecoveryDialog").then((module) => ({ default: module.RecoveryDialog })));

interface WikiLinkPreviewState {
  noteName: string;
  displayName?: string;
  path?: string;
  preview?: string;
  missing?: boolean;
  error?: string;
  x: number;
  y: number;
}

export function createCloseRequestHandler(
  close: () => Promise<boolean>,
  destroy: () => Promise<void>,
  onError: (error: unknown) => void = () => {},
) {
  let closeInProgress = false;
  return async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (closeInProgress) return;
    closeInProgress = true;
    try {
      const closed = await close();
      if (closed) await destroy();
      else closeInProgress = false;
    } catch (error) {
      closeInProgress = false;
      onError(error);
    }
  };
}

export function createAppCloseTransactionHandler(
  operationLeaseRegistry: ReturnType<typeof createOperationLeaseRegistry>,
  flush: () => Promise<boolean>,
  destroy: () => Promise<void>,
  onError: (error: unknown) => void = () => {},
) {
  return createCloseRequestHandler(
    async () => {
      await operationLeaseRegistry.waitForIdle();
      return flush();
    },
    destroy,
    onError,
  );
}


export default function App() {
  const operationLeaseRegistry = createOperationLeaseRegistry();
  const [isNewCollectionOpen, setIsNewCollectionOpen] = createSignal(false);
  const [newCollectionError, setNewCollectionError] = createSignal("");
  const [newNoteDirectory, setNewNoteDirectory] = createSignal("");
  const [newNoteDefaultName, setNewNoteDefaultName] = createSignal("Untitled Note");
  const [newNoteParentGroupId, setNewNoteParentGroupId] = createSignal<string | null>(null);
  const [isNewNoteOpen, setIsNewNoteOpen] = createSignal(false);
  const [newNoteError, setNewNoteError] = createSignal("");
  const [missingLinkName, setMissingLinkName] = createSignal("");
  const [isMissingLinkOpen, setIsMissingLinkOpen] = createSignal(false);
  const [isCreatingNewNote, setIsCreatingNewNote] = createSignal(false);
  const [createdNewNote, setCreatedNewNote] = createSignal<{ name: string; path: string } | null>(null);
  const [isQuickOpen, setIsQuickOpen] = createSignal(false);
  const [isContentSearchOpen, setIsContentSearchOpen] = createSignal(false);
  const [recoveryDrafts, setRecoveryDrafts] = createSignal<RecoveryDraft[]>([]);
  const [isRecoveryReviewOpen, setIsRecoveryReviewOpen] = createSignal(false);
  const [isRecoveryRestorePending, setIsRecoveryRestorePending] = createSignal(false);
  const [wikiLinkPreview, setWikiLinkPreview] = createSignal<WikiLinkPreviewState | null>(null);
  const [appNotice, setAppNotice] = createSignal<{ title: string; message: string } | null>(null);
  const [isMovePromptPending, setIsMovePromptPending] = createSignal(false);

  const [isSettingsOpen, setIsSettingsOpen] = createSignal(false);
  const [settings, setSettings] = createSignal<Settings>({
    theme: "dark",
    fontScale: 1.0,
  });

  const [globalError, setGlobalError] = createSignal<{ message: string; stack?: string } | null>(null);

  const showAppNotice = (title: string, err: unknown) => {
    const message = formatIpcError(err) || "Something went wrong";
    setAppNotice({ title, message });
    announcer.alert(message, announcementKey("urgent-error", "", message));
  };

  const closeEditorForTransition = async () => {
    const closed = await editorStore.closeFile();
    if (!closed) showAppNotice("Close blocked", editorStore.state.error || "Save failed; draft retained");
    return closed;
  };

  const refreshRecoveryDrafts = async () => {
    const stored = listRecoveryDrafts();
    const pending: RecoveryDraft[] = [];
    for (const draft of stored) {
      try {
        const raw = await editorApi.readFile(draft.path);
        const disk = typeof raw === "string" ? { content: raw, versionToken: "" } : raw;
        if (disk.versionToken === draft.baseVersionToken && disk.content === draft.content) {
          removeRecoveryDraft(draft.id);
        } else {
          pending.push(draft);
        }
      } catch {
        pending.push(draft);
      }
    }
    setRecoveryDrafts(pending);
    if (pending.length > 0) setIsRecoveryReviewOpen(true);
  };

  onMount(async () => {
    const disposeAnnouncer = mountAnnouncer(document.querySelector<HTMLElement>("[data-app-shell-root]") ?? document.body);
    const handleGlobalError = (event: ErrorEvent) => {
      console.error("Caught global error:", event.error);
      setGlobalError({
        message: event.message || "Unhandled JavaScript Error",
        stack: event.error?.stack,
      });
      announcer.alert(event.message || "Unhandled JavaScript error", announcementKey("urgent-error", "", event.message));
    };
    window.addEventListener("error", handleGlobalError);

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error("Caught unhandled promise rejection:", event.reason);
      setGlobalError({
        message: event.reason?.message || String(event.reason) || "Unhandled Promise Rejection",
        stack: event.reason?.stack,
      });
      announcer.alert(event.reason?.message || String(event.reason) || "Unhandled promise rejection", announcementKey("urgent-error", "", String(event.reason)));
    };
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    window.addEventListener("pagehide", flushPendingRecoveryDraft);
    window.addEventListener("beforeunload", flushPendingRecoveryDraft);

    const handleMissingWikilink = (event: Event) => {
      const noteName = (event as CustomEvent<{ noteName?: string }>).detail?.noteName;
      if (!noteName) return;
      setMissingLinkName(noteName);
      setIsMissingLinkOpen(true);
    };
    const handleWikilinkError = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      showAppNotice("WikiLink lookup failed", message || "Collectives could not check this link in the active collection.");
    };
    window.addEventListener("collectives:wikilink-missing", handleMissingWikilink);
    window.addEventListener("collectives:wikilink-error", handleWikilinkError);
    const handleWikilinkPreview = (event: Event) => {
      const detail = (event as CustomEvent<WikiLinkPreviewState>).detail;
      if (!detail || typeof detail.noteName !== "string") return;
      setWikiLinkPreview(detail);
    };
    const handleWikilinkPreviewHide = () => setWikiLinkPreview(null);
    window.addEventListener("collectives:wikilink-preview", handleWikilinkPreview);
    window.addEventListener("collectives:wikilink-preview-hide", handleWikilinkPreviewHide);

    const handleGlobalShortcut = (event: KeyboardEvent) => {
      if (event.isComposing || document.querySelector("[data-modal-focus-scope='true']")) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const textEditing = Boolean(target?.isContentEditable || target?.closest("input, textarea, [contenteditable='true']"));
      if (event.altKey && event.key === "ArrowLeft") {
        if (textEditing) return;
        event.preventDefault();
        void navigateHistory("back");
        return;
      }
      if (event.altKey && event.key === "ArrowRight") {
        if (textEditing) return;
        event.preventDefault();
        void navigateHistory("forward");
        return;
      }
      if (event.altKey || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "p" && !event.shiftKey) {
        event.preventDefault();
        if (collectionsStore.state.activeCollectionId) setIsQuickOpen(true);
        else showAppNotice("Choose a collection first", "Quick Open searches the active collection.");
      } else if (key === "f" && event.shiftKey) {
        event.preventDefault();
        if (collectionsStore.state.activeCollectionId) setIsContentSearchOpen(true);
        else showAppNotice("Choose a collection first", "Content search searches the active collection.");
      } else if (key === "n" && !event.shiftKey) {
        event.preventDefault();
        void handleNewNoteStart();
      }
    };
    window.addEventListener("keydown", handleGlobalShortcut);

    let unlistenClose: (() => void) | undefined;
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__ !== undefined) {
      try {
        const appWindow = getCurrentAppWindow();
        unlistenClose = await appWindow.onCloseRequested(
          createAppCloseTransactionHandler(
            operationLeaseRegistry,
            () => editorStore.closeFile(),
            () => appWindow.destroy(),
            (error) => showAppNotice("Close blocked", error),
          ),
        );
      } catch (err) {
        console.error("Failed to register close request listener:", err);
      }
    }

    onCleanup(() => {
      disposeAnnouncer();
      window.removeEventListener("error", handleGlobalError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("pagehide", flushPendingRecoveryDraft);
      window.removeEventListener("beforeunload", flushPendingRecoveryDraft);
      window.removeEventListener("collectives:wikilink-missing", handleMissingWikilink);
      window.removeEventListener("collectives:wikilink-error", handleWikilinkError);
      window.removeEventListener("collectives:wikilink-preview", handleWikilinkPreview);
      window.removeEventListener("collectives:wikilink-preview-hide", handleWikilinkPreviewHide);
      window.removeEventListener("keydown", handleGlobalShortcut);
      if (unlistenClose) {
        unlistenClose();
      }
    });

    try {
      await collectionsStore.loadCollections();
      const lastActiveId = localStorage.getItem("lastActiveCollectionId");
      if (lastActiveId && collectionsStore.state.collections.some(c => c.id === lastActiveId)) {
        let lastSelectedId = localStorage.getItem("lastSelectedEntryId");
        await collectionsStore.openCollection(lastActiveId);
        const activeCol = collectionsStore.activeCollection();
        const findById = (entries: Entry[], id: string): Entry | null => {
          for (const entry of entries) {
            if (entry.id === id) return entry;
            if (entry.type === "group") {
              const nested = findById(entry.children, id);
              if (nested) return nested;
            }
          }
          return null;
        };
        const priorEntry = activeCol && lastSelectedId ? findById(activeCol.entries, lastSelectedId) : null;
        const priorPath = priorEntry?.type === "file"
          ? priorEntry.path
          : !priorEntry && lastSelectedId && /[/\\]/.test(lastSelectedId)
            ? lastSelectedId
            : null;
        const staleEntryId = Boolean(lastSelectedId && !priorEntry && !/[/\\]/.test(lastSelectedId));
        if (priorPath || staleEntryId) {
          try {
            if (!priorPath) throw new Error("The last selected collection entry is no longer available.");
            await editorApi.readFile(priorPath);
          } catch (error) {
            lastSelectedId = null;
            if (!lastSelectedId) {
              showAppNotice("Last note unavailable", `${formatIpcError(error)}. Choose another note from the collection.`);
            }
          }
        }
        if (lastSelectedId) {
          await editorStore.selectEntry(lastSelectedId);
          if (activeCol) {
            const selectedId = lastSelectedId;
            const findAndExpand = (entries: Entry[], parentIds: string[]): boolean => {
              for (const entry of entries) {
                if (entry.id === selectedId) {
                  for (const pid of parentIds) {
                    uiStore.setExpanded(pid, true);
                  }
                  return true;
                }
                if (entry.type === "group") {
                  if (findAndExpand(entry.children, [...parentIds, entry.id])) {
                    return true;
                  }
                }
              }
              return false;
            };

            const findFolderRefAndExpand = (entries: Entry[], parentIds: string[]): boolean => {
              for (const entry of entries) {
                if (entry.type === "folder-ref") {
                  const cleanEntryPath = entry.path.replace(/\\/g, "/").toLowerCase();
                  const cleanTargetId = selectedId.replace(/\\/g, "/").toLowerCase();
                  if (cleanTargetId.startsWith(cleanEntryPath)) {
                    uiStore.setExpanded(entry.id, true);
                    for (const pid of parentIds) {
                      uiStore.setExpanded(pid, true);
                    }
                    const relativePath = selectedId.slice(entry.path.length);
                    const parts = relativePath.split(/[/\\]/).filter(Boolean);
                    let currentPath = entry.path;
                    for (let i = 0; i < parts.length - 1; i++) {
                      currentPath += (currentPath.endsWith("/") || currentPath.endsWith("\\") ? "" : "/") + parts[i];
                      uiStore.setExpanded(currentPath, true);
                    }
                    return true;
                  }
                }
                if (entry.type === "group") {
                  if (findFolderRefAndExpand(entry.children, [...parentIds, entry.id])) {
                    return true;
                  }
                }
              }
              return false;
            };

            if (!findAndExpand(activeCol.entries, [])) {
              findFolderRefAndExpand(activeCol.entries, []);
            }
          }
        }
      }
    } catch (err) {
      console.error("Failed to load collections on mount", err);
    }

    let unlisten: (() => void) | undefined;
    try {
      unlisten = await collectionsStore.initializeListeners();
      const loaded = await settingsApi.loadSettings();
      const effectiveSettings = {
        ...loaded,
        hideUnsupportedFiles: loaded.hideUnsupportedFiles ?? uiStore.state.hideUnsupportedFiles,
      };
      setSettings(effectiveSettings);
      uiStore.setHideUnsupportedFiles(effectiveSettings.hideUnsupportedFiles);
      applyThemeSettings(effectiveSettings);
      
      const fontsDir = await settingsApi.getFontsDir();
      registerCustomFonts(effectiveSettings.customFonts, fontsDir);
    } catch (err) {
      console.error("Failed to load settings on mount", err);
    }
    await refreshRecoveryDrafts();

    onCleanup(() => {
      if (unlisten) {
        unlisten();
      }
    });
  });

  const collectionNotes = () => {
    const notes: ResolveCandidate[] = [];
    const visit = (entries: Entry[]) => {
      for (const entry of entries) {
        if (entry.type === "file" && /\.md$/i.test(entry.path)) notes.push({ entryId: entry.id, path: entry.path, displayName: (entry.path.split(/[/\\]/).pop() ?? entry.path).replace(/\.md$/i, ""), entryType: "file" });
        else if (entry.type === "group") visit(entry.children);
        if (notes.length >= 100) break;
      }
    };
    visit(collectionsStore.activeCollection()?.entries ?? []);
    return notes;
  };

  createEffect(() => {
    const collectionId = collectionsStore.state.activeCollectionId;
    editorStore.setRecoveryCollectionId(collectionId);
    const path = editorStore.state.openFilePath;
    if (!collectionId || !path) return;
    recordNavigation({ collectionId, entryId: uiStore.state.selectedEntryId || path, path, displayName: (path.split(/[/\\]/).pop() ?? path).replace(/\.md$/i, ""), entryType: "file" });
  });

  // Import Folder state
  const [importFolderPath, setImportFolderPath] = createSignal("");
  const [isImportFolderNameOpen, setIsImportFolderNameOpen] = createSignal(false);
  const [importFolderNameError, setImportFolderNameError] = createSignal("");

  // Import ZIP state
  const [zipFilePath, setZipFilePath] = createSignal("");
  const [zipDestFolder, setZipDestFolder] = createSignal("");
  const [zipConflicts, setZipConflicts] = createSignal<ZipConflict[]>([]);
  const [isZipConflictOpen, setIsZipConflictOpen] = createSignal(false);

  // Import Folder triggers
  const handleImportFolderClick = async () => {
    try {
      const selected = await pickDirectory("Select Folder to Import");
      if (selected) {
        setImportFolderPath(selected);
        setImportFolderNameError("");
        setIsImportFolderNameOpen(true);
      }
    } catch (err) {
      console.error("Failed to pick folder", err);
      showAppNotice("Folder import could not start", err);
    }
  };

  const handleImportFolderConfirm = async (name?: string) => {
    if (!name) {
      setImportFolderNameError("Name cannot be empty");
      return;
    }
    try {
      await collectionsStore.importFolder(importFolderPath(), name);
      setIsImportFolderNameOpen(false);
    } catch (err: unknown) {
      setImportFolderNameError((err as Error).message || "Failed to import folder");
      showAppNotice("Folder import failed", err);
    }
  };

  // Import ZIP triggers
  const handleImportZipClick = async () => {
    try {
      const zipPath = await pickZipFile("Select ZIP Package to Import");
      if (!zipPath) return;

      const destFolder = await pickDirectory("Select Extraction Destination Folder");
      if (!destFolder) return;

      setZipFilePath(zipPath);
      setZipDestFolder(destFolder);

      const conflicts = await archiveApi.checkZipConflicts(zipPath, destFolder);
      if (conflicts.length > 0) {
        setZipConflicts(conflicts);
        setIsZipConflictOpen(true);
      } else {
        await runArchiveOperation(operationLeaseRegistry, "Import ZIP", () => collectionsStore.importZip(zipPath, destFolder, {}));
      }
    } catch (err) {
      console.error("Failed to import ZIP", err);
      showAppNotice("ZIP import failed", err);
    }
  };

  const handleZipConflictConfirm = async (resolutions: Record<string, string>) => {
    try {
      await collectionsStore.importZip(zipFilePath(), zipDestFolder(), resolutions);
      setIsZipConflictOpen(false);
    } catch (err) {
      console.error("Failed to import ZIP after conflicts resolved", err);
      showAppNotice("ZIP import failed", err);
    }
  };

  let selectionTransition: Promise<void> = Promise.resolve();
  const queueSelectionTransition = (transition: () => Promise<void>) => {
    selectionTransition = selectionTransition
      .then(transition)
      .catch((error) => showAppNotice("Selection transition failed", error));
  };

  // Synchronize selection store with editor store
  let lastFolderRefAnnouncement = "";
  createEffect(() => {
    const intent = folderRefReadiness.state.activeIntent;
    const record = intent ? getFolderRefReadiness(intent.collectionId, intent.folderRefEntryId, intent.childPath) : null;
    if (!intent || !record) return;
    const stateKey = `${record.key}:${record.status}`;
    if (!lastFolderRefAnnouncement) {
      lastFolderRefAnnouncement = stateKey;
      return;
    }
    if (stateKey === lastFolderRefAnnouncement) return;
    lastFolderRefAnnouncement = stateKey;
    const message = record.status === "checking"
      ? "Checking folder reference file readiness."
      : record.status === "ready"
        ? "Folder reference file is ready."
        : "Folder reference file could not be opened; retry is available when supported.";
    if (record.status !== "broken") announcer.transition("folder-ref", intent.folderRefEntryId, record.status, message);
  });

  let lastEditorError = "";
  createEffect(() => {
    const error = editorStore.state.error;
    if (!error || error === lastEditorError) return;
    lastEditorError = error;
    announcer.alert(error, announcementKey("urgent-error", "", error));
  });

  createEffect(() => {
    const folderIntent = folderRefReadiness.state.activeIntent;
    if (folderIntent && uiStore.state.selectedEntryId !== folderIntent.childPath) {
      cancelFolderRefReadiness(folderIntent.folderRefEntryId);
    } else if (folderIntent && uiStore.state.selectedEntryId === folderIntent.childPath) {
      const record = getFolderRefReadiness(folderIntent.collectionId, folderIntent.folderRefEntryId, folderIntent.childPath);
      if (record?.status === "checking") void resolveFolderRefIntent(folderIntent);
      return;
    }
    const info = getSelectedEntryInfo();
    if (info && (info.type === "file" || info.type === "file (inside folder-ref)")) {
      const isReadOnly = false;
      if (editorStore.state.openFilePath !== info.path) {
        queueSelectionTransition(async () => {
          await editorStore.openFile(info.path, isReadOnly);
        });
      }
    } else {
      if (editorStore.state.openFilePath !== null) {
        queueSelectionTransition(async () => {
          await closeEditorForTransition();
        });
      }
    }
  });


  const handleCreateCollection = async (name?: string) => {
    if (!name) {
      setNewCollectionError("Name cannot be empty");
      return;
    }
    try {
      await collectionsStore.createCollection(name);
      setIsNewCollectionOpen(false);
      setNewCollectionError("");
    } catch (err: unknown) {
      setNewCollectionError((err as Error).message || "Failed to create collection");
    }
  };

  // Helper to find selected entry info for display
  const getSelectedEntryInfo = () => {
    const selectedId = uiStore.state.selectedEntryId;
    if (!selectedId) return null;

    const activeCol = collectionsStore.activeCollection();
    if (!activeCol) return null;

    // First search recursively in active collection entries
    const recurse = (entries: Entry[]): Entry | null => {
      for (const entry of entries) {
        if (entry.id === selectedId) return entry;
        if (entry.type === "group") {
          const found = recurse(entry.children);
          if (found) return found;
        }
      }
      return null;
    };

    const entry = recurse(activeCol.entries);
    if (entry) {
      const relatedNotes: Array<{ id: string; name: string; path: string }> = [];
      if (entry.type === "group") {
        const collect = (entries: Entry[]) => {
          for (const child of entries) {
            if (child.type === "file") {
              relatedNotes.push({ id: child.id, name: child.path.split(/[/\\]/).pop() || child.path, path: child.path });
            } else if (child.type === "group") {
              collect(child.children);
            }
            if (relatedNotes.length >= 100) break;
          }
        };
        collect(entry.children);
      }
      return {
        id: entry.id,
        name: entry.type === "group" ? entry.name : (entry.path.split(/[/\\]/).pop() || entry.path),
        path: entry.type === "group" ? "Virtual Group" : entry.path,
        type: entry.type,
        relatedNotes,
      };
    }

    // If not found in manifest, it might be a lazy-loaded child in folder-ref (its selectedId is the absolute path)
    const fileName = selectedId.split(/[/\\]/).pop() || selectedId;
    return {
      id: selectedId,
      name: fileName.endsWith(".md") ? fileName.slice(0, -3) : fileName,
      path: selectedId,
      type: selectedId.endsWith(".md") ? "file (inside folder-ref)" : "folder (inside folder-ref)",
      relatedNotes: [],
    };
  };

  const activeFolderRefReadiness = () => {
    const intent = folderRefReadiness.state.activeIntent;
    return intent ? getFolderRefReadiness(intent.collectionId, intent.folderRefEntryId, intent.childPath) : null;
  };

  const getActivityStatus = () => {
    if (globalError()) return { label: "Application error", tone: "danger" as const };
    if (editorStore.state.conflictKind) return { label: "Conflict", tone: "danger" as const };
    if (editorStore.state.error) return { label: "Save needs attention", tone: "danger" as const };
    if (editorStore.state.isSaving) return { label: "Saving", tone: "warning" as const };
    if (editorStore.state.isDirty) return { label: "Unsaved changes", tone: "warning" as const };
    if (editorStore.state.openFilePath) return { label: "Saved", tone: "success" as const };
    if (collectionsStore.activeCollection()) return { label: "Collection ready", tone: "neutral" as const };
    return { label: "No collection selected", tone: "neutral" as const };
  };

  const selectedParentGroupId = () => {
    const selectedId = uiStore.state.selectedEntryId;
    const collection = collectionsStore.activeCollection();
    if (!selectedId || !collection) return null;
    const find = (entries: Entry[], parentGroupId: string | null): string | null => {
      for (const entry of entries) {
        if (entry.id === selectedId) return entry.type === "group" ? entry.id : parentGroupId;
        if (entry.type === "group") {
          const nested = find(entry.children, entry.id);
          if (nested !== null) return nested;
        }
      }
      return null;
    };
    return find(collection.entries, null);
  };

  const handleNewNoteStart = async (defaultName = "Untitled Note") => {
    if (!collectionsStore.activeCollection()) {
      showAppNotice("Choose a collection first", "New notes are added to the active collection.");
      return;
    }
    setNewNoteError("");
    setCreatedNewNote(null);
    setNewNoteDefaultName(defaultName);
    setNewNoteParentGroupId(selectedParentGroupId());
    try {
      const info = getSelectedEntryInfo();
      const isFolder = (info?.type === "folder-ref" || info?.type === "folder (inside folder-ref)") && info?.path !== editorStore.state.openFilePath;
      const path = info && info.type !== "group" ? info.path : editorStore.state.openFilePath;
      const parent = path ? path.replace(/[/\\][^/\\]+$/, "") : "";
      let lastDirectory = "";
      try { lastDirectory = localStorage.getItem(`collectives.noteDirectory.${collectionsStore.state.activeCollectionId}`) ?? ""; }
      catch { /* The current note still supplies a useful default without storage. */ }
      const directory = (isFolder ? path : parent) || lastDirectory || await pickDirectory("Choose a folder for the new note");
      if (!directory) return;
      setNewNoteDirectory(directory);
      setIsNewNoteOpen(true);
    } catch (error) {
      showAppNotice("Could not choose a note folder", error);
    }
  };

  const changeNewNoteDirectory = async () => {
    try {
      const directory = await pickDirectory("Choose a folder for the new note");
      if (directory) { setNewNoteDirectory(directory); setNewNoteError(""); }
    } catch (error) {
      setNewNoteError(`Could not change the save folder. ${formatIpcError(error)}`);
    }
  };

  const handleCreateNewNote = async (rawName?: string) => {
    const inputName = (rawName ?? "").trim();
    if (!inputName) {
      setNewNoteError("Enter a note name.");
      return;
    }
    if (/[\\/\0]/.test(inputName)) {
      setNewNoteError("Use a file name without folder separators.");
      return;
    }
    const baseName = inputName.replace(/\.md$/i, "").trim();
    if (!baseName || baseName === "." || baseName === "..") {
      setNewNoteError("Enter a valid note name.");
      return;
    }
    const noteName = `${baseName}.md`;
    const prior = createdNewNote();
    const separator = newNoteDirectory().endsWith("/") || newNoteDirectory().endsWith("\\") ? "" : "/";
    const targetPath = prior?.name === noteName
      ? prior.path
      : `${newNoteDirectory()}${separator}${noteName}`;
    setIsCreatingNewNote(true);
    setNewNoteError("");
    try {
      if (!prior || prior.name !== noteName) {
        await editorApi.createFile(targetPath, "# " + baseName + "\n\n");
        setCreatedNewNote({ name: noteName, path: targetPath });
      }
      await collectionsStore.addFiles([targetPath], newNoteParentGroupId() ?? undefined);
      try { localStorage.setItem(`collectives.noteDirectory.${collectionsStore.state.activeCollectionId}`, newNoteDirectory()); }
      catch { /* Creating a note does not depend on remembering its save folder. */ }
      const active = collectionsStore.activeCollection();
      const normalizePath = (path: string) => path.replace(/\\/g, "/").toLowerCase();
      const findFile = (entries: Entry[]): Entry | null => {
        for (const entry of entries) {
          if (entry.type === "file" && normalizePath(entry.path) === normalizePath(targetPath)) return entry;
          if (entry.type === "group") {
            const nested = findFile(entry.children);
            if (nested) return nested;
          }
        }
        return null;
      };
      const entry = active ? findFile(active.entries) : null;
      if (!entry) throw new Error("The note was created, but it is not visible in the collection yet. You can retry adding it.");
      setIsNewNoteOpen(false);
      setCreatedNewNote(null);
      const selected = await editorStore.selectEntry(entry.id);
      if (!selected) {
        showAppNotice("Note created", "The note is in the collection, but the current draft could not be saved before opening it.");
        return;
      }
      requestAnimationFrame(() => document.querySelector<HTMLElement>(".editor-workspace .cm-content[contenteditable='true']")?.focus());
    } catch (error) {
      const message = formatIpcError(error) || String(error);
      setNewNoteError(createdNewNote()
        ? `The note exists at ${createdNewNote()!.path}, but it could not be added to the collection. Retry to add this same file. ${message}`
        : message);
    } finally {
      setIsCreatingNewNote(false);
    }
  };

  const openQuickCandidate = async (candidate: ResolveCandidate): Promise<boolean> => {
    const selected = await editorStore.selectEntry(candidate.entryId);
    if (!selected) return false;
    if (editorStore.state.openFilePath !== candidate.path) await editorStore.openFile(candidate.path);
    return editorStore.state.openFilePath === candidate.path;
  };

  const openContentResult = async (result: ContentSearchResult): Promise<boolean> => {
    const opened = await openQuickCandidate({
      displayName: result.displayName,
      entryId: result.entryId,
      path: result.path,
      entryType: "file",
    });
    if (opened) editorStore.navigateToPosition(result.path, result.lineNumber, result.columnUtf16);
    return opened;
  };

  const navigateHistory = async (direction: "back" | "forward") => {
    const collectionId = collectionsStore.state.activeCollectionId;
    if (!collectionId) return false;
    const target = peekHistoryTarget(collectionId, direction);
    if (!target) return false;
    const opened = await openQuickCandidate(target);
    if (!opened) cancelHistoryNavigation(collectionId);
    return opened;
  };

  const handleRestoreRecoveryDraft = async (draft: RecoveryDraft) => {
    setIsRecoveryRestorePending(true);
    try {
      if (collectionsStore.state.collections.some((collection) => collection.id === draft.collectionId)
        && collectionsStore.state.activeCollectionId !== draft.collectionId) {
        await collectionsStore.openCollection(draft.collectionId);
      }
      const collection = collectionsStore.activeCollection();
      const findEntry = (entries: Entry[]): Entry | null => {
        for (const entry of entries) {
          if (entry.id === draft.entryId || (entry.type === "file" && entry.path.toLowerCase() === draft.path.toLowerCase())) return entry;
          if (entry.type === "group") {
            const nested = findEntry(entry.children);
            if (nested) return nested;
          }
        }
        return null;
      };
      const entry = collection ? findEntry(collection.entries) : null;
      editorStore.setRecoveryCollectionId(draft.collectionId);
      const restored = await editorStore.restoreRecoveredDraft(draft, entry?.id ?? draft.path);
      if (!restored) throw new Error("The draft restore was superseded by another file operation.");
      setRecoveryDrafts((items) => items.filter((item) => item.id !== draft.id));
      if (recoveryDrafts().length <= 1) setIsRecoveryReviewOpen(false);
    } finally {
      setIsRecoveryRestorePending(false);
    }
  };

  const handleDiscardRecoveryDraft = (draft: RecoveryDraft) => {
    removeRecoveryDraft(draft.id);
    setRecoveryDrafts((items) => items.filter((item) => item.id !== draft.id));
    if (recoveryDrafts().length <= 1) setIsRecoveryReviewOpen(false);
  };

  return (
    <>
      <AppShell
      sidebar={
        <TreeWorkspace
          onNewNoteClick={handleNewNoteStart}
          onQuickOpen={() => setIsQuickOpen(true)}
          onContentSearch={() => setIsContentSearchOpen(true)}
          recoveryDraftCount={recoveryDrafts().length}
          onReviewRecovery={() => setIsRecoveryReviewOpen(true)}
          onNewCollectionClick={() => {
            setNewCollectionError("");
            setIsNewCollectionOpen(true);
          }}
          onImportFolderClick={handleImportFolderClick}
          onImportZipClick={handleImportZipClick}
          onSettingsClick={() => setIsSettingsOpen(true)}
          requestSelect={(entryId) => editorStore.selectEntry(entryId)}
          requestFolderRefSelect={requestFolderRefChild}
          onReviewMovePrompt={() => collectionsStore.reviewMovePrompt()}
          requestSwitch={async (collectionId) => {
            try {
              await collectionsStore.openCollection(collectionId);
              return true;
            } catch (error) {
              showAppNotice("Collection switch failed", error);
              return false;
            }
          }}
          operationLeaseRegistry={operationLeaseRegistry}
        />
      }
      workspaceHeader={
        <WorkspaceHeader isEditorOpen={Boolean(editorStore.state.openFilePath)}>
          <Show when={editorStore.state.openFilePath}>
            <EditorToolbar
              canGoBack={() => Boolean(collectionsStore.state.activeCollectionId && canNavigateBack(collectionsStore.state.activeCollectionId))}
              canGoForward={() => Boolean(collectionsStore.state.activeCollectionId && canNavigateForward(collectionsStore.state.activeCollectionId))}
              onBack={() => void navigateHistory("back")}
              onForward={() => void navigateHistory("forward")}
            />
          </Show>
        </WorkspaceHeader>
      }
      activityStatus={<ActivityStatus label={getActivityStatus().label} tone={getActivityStatus().tone} />}
      workspaceBody={
        <CollectionWorkspace>
          <FolderRefReadinessNotice
            record={activeFolderRefReadiness()}
            onRetry={() => {
              const record = activeFolderRefReadiness();
              if (record) retryFolderRefChild(record);
            }}
          />
          <Show
            when={collectionsStore.activeCollection()}
            fallback={
              <EmptyWorkspace
                onNewCollection={() => {
                  setNewCollectionError("");
                  setIsNewCollectionOpen(true);
                }}
                onImportFolder={handleImportFolderClick}
                onImportZip={handleImportZipClick}
              />
            }
          >
            <Show
              when={editorStore.state.openFilePath}
              fallback={
                <div class="selected-entry-panel">
                <Show when={editorStore.state.error}>
                  <div class="editor-error-banner selected-entry-error">
                    <span>Error: {editorStore.state.error}</span>
                    <button class="btn-close selected-entry-error-clear" onClick={async () => { await closeEditorForTransition(); }}>
                      Clear
                    </button>
                  </div>
                </Show>
                <Show
                  when={getSelectedEntryInfo()}
                  fallback={
                    <WorkspaceHome collectionName={collectionsStore.activeCollection()?.name ?? "Your notes"} notes={collectionNotes()} onNewNote={() => void handleNewNoteStart()} onQuickOpen={() => setIsQuickOpen(true)} onOpen={openQuickCandidate} />
                  }
                >
                  {(info) => (
                    <>
                      <div class="selected-entry-header">
                        <h2 class="selected-entry-title">{info().name}</h2>
                        <div class="selected-entry-meta">{info().type === "group" ? "Virtual group" : info().type === "folder-ref" ? "Folder reference" : "Local note"}</div>
                      </div>
                      <div class="selected-entry-body">
                        <Show when={info().type === "group"}>
                          <p>This group organizes note references. It does not create a folder on disk.</p>
                          <div class="selected-entry-card">
                            <h4>Notes in this group ({info().relatedNotes?.length ?? 0})</h4>
                            <Show when={(info().relatedNotes?.length ?? 0) > 0} fallback={<p>This group is empty. Create a note here or add existing files.</p>}>
                              <For each={info().relatedNotes ?? []}>{(note) => <button class="selected-entry-related-note" title={note.path} onClick={() => void editorStore.selectEntry(note.id)}>{note.name}</button>}</For>
                            </Show>
                          </div>
                          <button class="btn btn-primary" onClick={() => void handleNewNoteStart()}>New note in this group</button>
                        </Show>
                        <Show when={info().type === "folder-ref" || String(info().type).includes("folder-ref") }>
                          <p>This folder is referenced in place. Files stay in their original location.</p>
                          <code class="selected-entry-path">{info().path}</code>
                          <button class="btn btn-primary" onClick={() => void handleNewNoteStart()}>New note…</button>
                        </Show>
                      </div>
                    </>
                  )}
                </Show>
                </div>
              }
            >
              <DocumentWorkspace isOpen={true} />
            </Show>
          </Show>
        </CollectionWorkspace>
      }
      sidebarCollapsed={!uiStore.state.isSidebarOpen}
      onExpandSidebar={() => uiStore.toggleSidebar()}
      notice={
        <>
          <Show when={appNotice()}>
            {(notice) => (
              <div class="app-notice">
                <div class="app-notice-icon"><Icon name="warning" size={16} /></div>
                <div class="app-notice-copy">
                  <strong>{notice().title}</strong>
                  <span>{notice().message}</span>
                </div>
                <button class="btn btn-text btn-icon" aria-label="Dismiss notification" onClick={() => setAppNotice(null)} title="Dismiss notification">
                  <Icon name="close" size={14} />
                </button>
              </div>
            )}
          </Show>
          <Show when={wikiLinkPreview()}>
            {(preview) => {
              const left = () => Math.min(Math.max(12, preview().x), Math.max(12, window.innerWidth - 332));
              const top = () => Math.min(Math.max(12, preview().y), Math.max(12, window.innerHeight - 252));
              return (
                <div class="cm-wikilink-preview" role="tooltip" style={{ left: `${left()}px`, top: `${top()}px` }}>
                  <div class="cm-wikilink-preview-header">
                    <strong>{preview().displayName || preview().noteName}</strong>
                    <button class="btn btn-text" aria-label="Close note preview" onClick={() => setWikiLinkPreview(null)}>×</button>
                  </div>
                  <Show when={preview().path}><small>{preview().path}</small></Show>
                  <Show when={preview().missing}>
                    <p>This note is missing from the active collection.</p>
                    <button class="btn btn-primary" onClick={() => {
                      const name = preview().noteName;
                      setWikiLinkPreview(null);
                      void handleNewNoteStart(name);
                    }}>Create target note…</button>
                  </Show>
                  <Show when={preview().error}><p class="cm-wikilink-preview-error">Preview unavailable: {preview().error}</p></Show>
                  <Show when={preview().preview}><pre>{preview().preview}</pre></Show>
                </div>
              );
            }}
          </Show>
          <Show when={globalError()}>
            {(error) => (
              <div class="app-shell-global-error">
                <div class="app-shell-global-error-header">
                  <span>Unhandled application error</span>
                  <button class="btn btn-text app-shell-global-error-dismiss" onClick={() => setGlobalError(null)}>Dismiss</button>
                </div>
                <div class="app-shell-global-error-details">
                  {error().message}
                  {error().stack && (
                    <details>
                      <summary>View Stack Trace</summary>
                      <pre>{error().stack}</pre>
                    </details>
                  )}
                </div>
              </div>
            )}
          </Show>
        </>
      }
      />
      <Dialog
        isOpen={isNewCollectionOpen()}
        title="Create New Collection"
        type="input"
        placeholder="Collection name"
        errorMessage={newCollectionError()}
        onConfirm={handleCreateCollection}
        onClose={() => setIsNewCollectionOpen(false)}
      />

      <Dialog
        isOpen={isNewNoteOpen()}
        title="Create a new note"
        type="input"
        defaultValue={newNoteDefaultName()}
        placeholder="Note name"
        errorMessage={newNoteError()}
        pending={isCreatingNewNote()}
        inputDisabled={Boolean(createdNewNote())}
        confirmLabel={isCreatingNewNote() ? "Creating…" : "Create note"}
        onConfirm={handleCreateNewNote}
        onClose={() => {
          if (createdNewNote()) showAppNotice("Note not added to collection", `The file remains on disk at ${createdNewNote()!.path}.`);
          setCreatedNewNote(null);
          setNewNoteError("");
          setIsNewNoteOpen(false);
        }}
      >
        <div class="note-save-location">
          <div><span>Save to folder</span><code>{newNoteDirectory()}</code></div>
          <button type="button" class="btn btn-text" disabled={isCreatingNewNote() || Boolean(createdNewNote())} onClick={() => void changeNewNoteDirectory()}>Change…</button>
        </div>
        <p class="note-save-hint">A Markdown file will be saved here. Groups organize your notes without moving files on disk.</p>
      </Dialog>

      <Dialog
        isOpen={isMissingLinkOpen()}
        title="WikiLink target not found"
        type="confirm"
        message={`“${missingLinkName()}” is not in the active collection. Create a note for this target?`}
        confirmLabel="Choose save folder"
        cancelLabel="Keep writing"
        onConfirm={async () => {
          const name = missingLinkName();
          setIsMissingLinkOpen(false);
          await handleNewNoteStart(name);
        }}
        onClose={() => setIsMissingLinkOpen(false)}
      />

      <SettingsWorkflow
        isOpen={isSettingsOpen()}
        leaseRegistry={operationLeaseRegistry}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings()}
        onSettingsChange={setSettings}
      />

      <ArchiveWorkflow
        leaseRegistry={operationLeaseRegistry}
        importFolderPath={importFolderPath()}
        importFolderNameOpen={isImportFolderNameOpen()}
        importFolderNameError={importFolderNameError()}
        onImportFolderConfirm={handleImportFolderConfirm}
        onImportFolderClose={() => setIsImportFolderNameOpen(false)}
        zipFilePath={zipFilePath()}
        zipDestFolder={zipDestFolder()}
        zipConflicts={zipConflicts()}
        zipConflictOpen={isZipConflictOpen()}
        onZipConfirm={handleZipConflictConfirm}
        onZipClose={() => setIsZipConflictOpen(false)}
      />

      <Dialog
        isOpen={collectionsStore.state.movePrompt !== null && !collectionsStore.state.movePromptDeferred}
        title="File Moved or Renamed"
        type="confirm"
        pending={isMovePromptPending()}
        confirmLabel="Update path"
        cancelLabel="Later"
        onConfirm={async () => {
          const prompt = collectionsStore.state.movePrompt;
          if (prompt) {
            setIsMovePromptPending(true);
            try {
              await collectionsStore.relinkEntry(prompt.entryId, prompt.newPath);
              collectionsStore.clearMovePrompt();
            } catch (error) {
              showAppNotice("Could not update file path", error);
            } finally {
              setIsMovePromptPending(false);
            }
          }
        }}
        onClose={() => collectionsStore.deferMovePrompt()}
      >
        <p style={{ "font-size": "13px", "margin-bottom": "8px" }}>
          The file <strong>{collectionsStore.state.movePrompt?.fileName}</strong> was moved or renamed to:
        </p>
        <div style={{
          "background-color": "var(--color-code-bg)",
          color: "var(--color-code-text)",
          padding: "8px",
          "border-radius": "4px",
          "font-family": "var(--font-mono)",
          "font-size": "12px",
          "word-break": "break-all",
          "margin-bottom": "12px"
        }}>
          {collectionsStore.state.movePrompt?.newPath}
        </div>
        <p style={{ "font-size": "13px" }}>
          Update the collection path to keep this note linked. Later keeps the entry for you to review again. Removing an entry only removes its collection reference; it does not delete the file from disk.
        </p>
        <button class="btn btn-text" disabled={isMovePromptPending()} onClick={async () => {
          const prompt = collectionsStore.state.movePrompt;
          if (!prompt) return;
          setIsMovePromptPending(true);
          try {
            await collectionsStore.removeEntry(prompt.entryId);
            collectionsStore.clearMovePrompt();
          } catch (error) {
            showAppNotice("Could not remove collection reference", error);
          } finally {
            setIsMovePromptPending(false);
          }
        }}>
          Remove from collection
        </button>
      </Dialog>
      <Show when={isQuickOpen()}>
        <QuickOpenDialog
          isOpen={true}
          collectionId={collectionsStore.state.activeCollectionId}
          onClose={() => setIsQuickOpen(false)}
          onOpen={openQuickCandidate}
        />
      </Show>
      <Show when={isContentSearchOpen()}>
        <ContentSearchDialog
          isOpen={true}
          collectionId={collectionsStore.state.activeCollectionId}
          onClose={() => setIsContentSearchOpen(false)}
          onOpen={openContentResult}
        />
      </Show>
      <Show when={recoveryDrafts().length > 0}>
        <RecoveryDialog
          drafts={recoveryDrafts()}
          isOpen={isRecoveryReviewOpen()}
          pending={isRecoveryRestorePending()}
          onLater={() => setIsRecoveryReviewOpen(false)}
          onRestore={handleRestoreRecoveryDraft}
          onDiscard={handleDiscardRecoveryDraft}
        />
      </Show>
    </>
  );
}
