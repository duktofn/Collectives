import { createSignal, Show, createEffect, onMount, onCleanup } from "solid-js";
import { collectionsStore } from "./stores/collections";
import { uiStore } from "./stores/ui";
import { Dialog } from "./components/common/Dialog";
import { Icon } from "./components/common/Icon";
import { Entry, ZipConflict, Settings } from "./types";
import { editorStore } from "./stores/editor";
import { EditorToolbar } from "./components/editor/EditorToolbar";
import { AppShell } from "./components/shell/AppShell";
import { WorkspaceHeader } from "./components/shell/WorkspaceHeader";
import { ActivityStatus } from "./components/shell/ActivityStatus";
import { EmptyWorkspace } from "./components/shell/EmptyWorkspace";
import * as settingsApi from "./features/settings";
import * as archiveApi from "./features/archive";
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
import "./App.css";

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
  const [appNotice, setAppNotice] = createSignal<{ title: string; message: string } | null>(null);

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
      if (unlistenClose) {
        unlistenClose();
      }
    });

    try {
      await collectionsStore.loadCollections();
      const lastActiveId = localStorage.getItem("lastActiveCollectionId");
      if (lastActiveId && collectionsStore.state.collections.some(c => c.id === lastActiveId)) {
        const lastSelectedId = localStorage.getItem("lastSelectedEntryId");
        await collectionsStore.openCollection(lastActiveId);
        if (lastSelectedId) {
          await editorStore.selectEntry(lastSelectedId);
          const activeCol = collectionsStore.activeCollection();
          if (activeCol) {
            const findAndExpand = (entries: Entry[], parentIds: string[]): boolean => {
              for (const entry of entries) {
                if (entry.id === lastSelectedId) {
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
                  const cleanTargetId = lastSelectedId.replace(/\\/g, "/").toLowerCase();
                  if (cleanTargetId.startsWith(cleanEntryPath)) {
                    uiStore.setExpanded(entry.id, true);
                    for (const pid of parentIds) {
                      uiStore.setExpanded(pid, true);
                    }
                    const relativePath = lastSelectedId.slice(entry.path.length);
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
      setSettings(loaded);
      applyThemeSettings(loaded);
      
      const fontsDir = await settingsApi.getFontsDir();
      registerCustomFonts(loaded.customFonts, fontsDir);
    } catch (err) {
      console.error("Failed to load settings on mount", err);
    }

    onCleanup(() => {
      if (unlisten) {
        unlisten();
      }
    });
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
      return {
        id: entry.id,
        name: entry.type === "group" ? entry.name : (entry.path.split(/[/\\]/).pop() || entry.path),
        path: entry.type === "group" ? "Virtual Group" : entry.path,
        type: entry.type,
      };
    }

    // If not found in manifest, it might be a lazy-loaded child in folder-ref (its selectedId is the absolute path)
    const fileName = selectedId.split(/[/\\]/).pop() || selectedId;
    return {
      id: selectedId,
      name: fileName.endsWith(".md") ? fileName.slice(0, -3) : fileName,
      path: selectedId,
      type: selectedId.endsWith(".md") ? "file (inside folder-ref)" : "folder (inside folder-ref)",
    };
  };

  const activeFolderRefReadiness = () => {
    const intent = folderRefReadiness.state.activeIntent;
    return intent ? getFolderRefReadiness(intent.collectionId, intent.folderRefEntryId, intent.childPath) : null;
  };

  const getActivityStatus = () => {
    if (globalError()) return { label: "Application error", tone: "danger" as const };
    if (editorStore.state.error) return { label: "Save needs attention", tone: "danger" as const };
    if (editorStore.state.isSaving) return { label: "Saving", tone: "warning" as const };
    if (editorStore.state.isDirty) return { label: "Unsaved changes", tone: "warning" as const };
    if (editorStore.state.openFilePath) return { label: "Saved", tone: "success" as const };
    if (collectionsStore.activeCollection()) return { label: "Collection ready", tone: "neutral" as const };
    return { label: "No collection selected", tone: "neutral" as const };
  };

  return (
    <>
      <AppShell
      sidebar={
        <TreeWorkspace
          onNewCollectionClick={() => {
            setNewCollectionError("");
            setIsNewCollectionOpen(true);
          }}
          onImportFolderClick={handleImportFolderClick}
          onImportZipClick={handleImportZipClick}
          onSettingsClick={() => setIsSettingsOpen(true)}
          requestSelect={(entryId) => editorStore.selectEntry(entryId)}
          requestFolderRefSelect={requestFolderRefChild}
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
            <EditorToolbar />
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
                    <div class="selected-entry-empty">
                      <Icon name="file" size={44} aria-hidden="true" />
                      <span>Select a Markdown note from the sidebar to start reading or editing.</span>
                    </div>
                  }
                >
                  {(info) => (
                    <>
                      <div class="selected-entry-header">
                        <h2 class="selected-entry-title">{info().name}</h2>
                        <div class="selected-entry-meta">
                          <strong>Type:</strong> {info().type}
                        </div>
                      </div>
                      <div class="selected-entry-body">
                        <p>You have selected a file in the collection explorer.</p>
                        <div class="selected-entry-card">
                          <h4>File Details</h4>
                          <code>Path: {info().path}</code>
                          <code>ID: {info().id}</code>
                        </div>
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
        isOpen={collectionsStore.state.movePrompt !== null}
        title="File Moved or Renamed"
        type="confirm"
        onConfirm={async () => {
          const prompt = collectionsStore.state.movePrompt;
          if (prompt) {
            await collectionsStore.relinkEntry(prompt.entryId, prompt.newPath);
            collectionsStore.clearMovePrompt();
          }
        }}
        onClose={() => {
          const prompt = collectionsStore.state.movePrompt;
          if (prompt) {
            collectionsStore.removeEntry(prompt.entryId);
            collectionsStore.clearMovePrompt();
          }
        }}
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
          Do you want to update its path in the collection? If you select <strong>Cancel (No)</strong>, the entry will be removed from the collection.
        </p>
      </Dialog>
    </>
  );
}
