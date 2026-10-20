import { onMount, onCleanup } from "solid-js";
import { collectionsStore } from "../stores/collections";
import { editorStore } from "../stores/editor";
import { uiStore } from "../stores/ui";
import type { Entry, Settings } from "../types";
import * as editorApi from "../features/editor";
import * as settingsApi from "../features/settings";
import { getCurrentAppWindow } from "../platform";
import { formatIpcError } from "../shared/ipc/errors";
import { applyThemeSettings, registerCustomFonts } from "../lib/themeEngine";
import { announcementKey, announcer, mountAnnouncer } from "../a11y/announcer";
import { flushPendingRecoveryDraft } from "../features/editor/recovery";
import { createOperationLeaseRegistry } from "./operationLease";
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


const DEFAULT_SETTINGS: Settings = { theme: "dark", fontScale: 1.0 };

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


interface LifecycleOptions {
  setGlobalError: (value: { message: string; stack?: string }) => unknown;
  setMissingLinkName: (value: string) => unknown;
  setIsMissingLinkOpen: (value: boolean) => unknown;
  setWikiLinkPreview: (value: WikiLinkPreviewState | null) => unknown;
  navigateHistory: (direction: "back" | "forward") => Promise<boolean>;
  setIsQuickOpen: (value: boolean) => unknown;
  openContentSearch: () => void;
  handleNewNoteStart: () => Promise<void>;
  operationLeaseRegistry: ReturnType<typeof createOperationLeaseRegistry>;
  showAppNotice: (title: string, error: unknown) => void;
  setSettings: (value: Settings) => unknown;
  setSettingsLoadIssue: (value: string | null) => unknown;
  setSettingsRecoveryError: (value: string) => unknown;
  setIsSettingsRecoveryDialogOpen: (value: boolean) => unknown;
  refreshRecoveryDrafts: () => Promise<void>;
}

export function createAppLifecycleWorkflow(options: LifecycleOptions) {
  const { setGlobalError, setMissingLinkName, setIsMissingLinkOpen, setWikiLinkPreview, navigateHistory, setIsQuickOpen, openContentSearch, handleNewNoteStart, operationLeaseRegistry, showAppNotice, setSettings, setSettingsLoadIssue, setSettingsRecoveryError, setIsSettingsRecoveryDialogOpen, refreshRecoveryDrafts } = options;
  const cleanups: (() => void)[] = [];
  let disposed = false;
  const ownCleanup = (dispose: () => void) => {
    if (disposed) dispose();
    else cleanups.push(dispose);
  };
  // Register synchronously: async initialization may finish after unmount.
  onCleanup(() => {
    disposed = true;
    for (const dispose of cleanups.splice(0)) dispose();
  });
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
        if (collectionsStore.state.activeCollectionId) openContentSearch();
        else showAppNotice("Choose a collection first", "Content search searches the active collection.");
      } else if (key === "n" && !event.shiftKey) {
        event.preventDefault();
        void handleNewNoteStart();
      }
    };
    window.addEventListener("keydown", handleGlobalShortcut);

    ownCleanup(() => {
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
    });
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__ !== undefined) {
      try {
        const appWindow = getCurrentAppWindow();
        const unlistenClose = await appWindow.onCloseRequested(
          createAppCloseTransactionHandler(
            operationLeaseRegistry,
            () => editorStore.closeFile(),
            () => appWindow.destroy(),
            (error) => showAppNotice("Close blocked", error),
          ),
        );
        ownCleanup(unlistenClose);
      } catch (err) {
        console.error("Failed to register close request listener:", err);
      }
    }



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
    } catch (err) {
      console.error("Failed to initialize collection listeners", err);
    }

    try {
      const loaded = await settingsApi.loadSettings();
      setSettings(loaded);
      applyThemeSettings(loaded);
      try {
        const fontsDir = await settingsApi.getFontsDir();
        registerCustomFonts(loaded.customFonts, fontsDir);
      } catch (err) {
        showAppNotice("Could not load custom fonts", err);
      }
    } catch (err) {
      console.error("Failed to load settings on mount", err);
      setSettings(DEFAULT_SETTINGS);
      applyThemeSettings(DEFAULT_SETTINGS);
      if (settingsApi.isSettingsRecoveryError(err)) {
        setSettingsLoadIssue(formatIpcError(err) || String(err));
        setSettingsRecoveryError("");
        setIsSettingsRecoveryDialogOpen(true);
      } else {
        showAppNotice("Could not load settings", err);
      }
    }
    await refreshRecoveryDrafts();

    ownCleanup(() => {
      if (unlisten) {
        unlisten();
      }
    });
  });
}
