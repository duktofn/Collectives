import { createSignal, Show, createEffect, onMount, onCleanup } from "solid-js";
import { collectionsStore } from "./stores/collections";
import { uiStore } from "./stores/ui";
import { Sidebar } from "./components/sidebar/Sidebar";
import { Dialog } from "./components/common/Dialog";
import { Icon } from "./components/common/Icon";
import { Entry, ZipConflict, Settings } from "./types";
import { editorStore } from "./stores/editor";
import { Editor } from "./components/editor/Editor";
import * as api from "./lib/tauri";
import { ZipConflictDialog } from "./components/common/ZipConflictDialog";
import { ThemePanel } from "./components/theme/ThemePanel";
import { applyThemeSettings, registerCustomFonts } from "./lib/themeEngine";
import "./App.css";


export default function App() {
  const [isNewCollectionOpen, setIsNewCollectionOpen] = createSignal(false);
  const [newCollectionError, setNewCollectionError] = createSignal("");

  const [isSettingsOpen, setIsSettingsOpen] = createSignal(false);
  const [settings, setSettings] = createSignal<Settings>({
    theme: "dark",
    fontScale: 1.0,
  });

  const [globalError, setGlobalError] = createSignal<{ message: string; stack?: string } | null>(null);

  onMount(async () => {
    const handleGlobalError = (event: ErrorEvent) => {
      console.error("Caught global error:", event.error);
      setGlobalError({
        message: event.message || "Unhandled JavaScript Error",
        stack: event.error?.stack,
      });
    };
    window.addEventListener("error", handleGlobalError);

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error("Caught unhandled promise rejection:", event.reason);
      setGlobalError({
        message: event.reason?.message || String(event.reason) || "Unhandled Promise Rejection",
        stack: event.reason?.stack,
      });
    };
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    onCleanup(() => {
      window.removeEventListener("error", handleGlobalError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    });

    try {
      await collectionsStore.loadCollections();
      const lastActiveId = localStorage.getItem("lastActiveCollectionId");
      if (lastActiveId && collectionsStore.state.collections.some(c => c.id === lastActiveId)) {
        await collectionsStore.openCollection(lastActiveId);
      }
    } catch (err) {
      console.error("Failed to load collections on mount", err);
    }

    let unlisten: (() => void) | undefined;
    try {
      unlisten = await collectionsStore.initializeListeners();
      const loaded = await api.loadSettings();
      setSettings(loaded);
      applyThemeSettings(loaded);
      
      const fontsDir = await api.getFontsDir();
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
      const selected = await api.pickDirectory("Select Folder to Import");
      if (selected) {
        setImportFolderPath(selected);
        setImportFolderNameError("");
        setIsImportFolderNameOpen(true);
      }
    } catch (err) {
      console.error("Failed to pick folder", err);
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
    }
  };

  // Import ZIP triggers
  const handleImportZipClick = async () => {
    try {
      const zipPath = await api.pickZipFile("Select ZIP Package to Import");
      if (!zipPath) return;

      const destFolder = await api.pickDirectory("Select Extraction Destination Folder");
      if (!destFolder) return;

      setZipFilePath(zipPath);
      setZipDestFolder(destFolder);

      const conflicts = await api.checkZipConflicts(zipPath, destFolder);
      if (conflicts.length > 0) {
        setZipConflicts(conflicts);
        setIsZipConflictOpen(true);
      } else {
        await collectionsStore.importZip(zipPath, destFolder, {});
      }
    } catch (err) {
      console.error("Failed to import ZIP", err);
    }
  };

  const handleZipConflictConfirm = async (resolutions: Record<string, string>) => {
    try {
      await collectionsStore.importZip(zipFilePath(), zipDestFolder(), resolutions);
      setIsZipConflictOpen(false);
    } catch (err) {
      console.error("Failed to import ZIP after conflicts resolved", err);
    }
  };

  // Synchronize selection store with editor store
  createEffect(() => {
    const info = getSelectedEntryInfo();
    if (info && (info.type === "file" || info.type === "file (inside folder-ref)")) {
      const isReadOnly = info.type === "file (inside folder-ref)";
      if (editorStore.state.openFilePath !== info.path) {
        editorStore.openFile(info.path, isReadOnly);
      }
    } else {
      if (editorStore.state.openFilePath !== null) {
        editorStore.closeFile();
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

  return (
    <div class="app-container">
      <Sidebar
        onNewCollectionClick={() => {
          setNewCollectionError("");
          setIsNewCollectionOpen(true);
        }}
        onImportFolderClick={handleImportFolderClick}
        onImportZipClick={handleImportZipClick}
        onSettingsClick={() => setIsSettingsOpen(true)}
      />

      <main class="main-content">
        <Show when={globalError()}>
          <div class="global-error-banner" style={{
            "background-color": "var(--color-danger-bg)",
            color: "var(--color-danger)",
            border: "1px solid var(--color-danger)",
            padding: "16px",
            margin: "16px",
            "border-radius": "var(--radius-md)",
            display: "flex",
            "flex-direction": "column",
            gap: "8px",
            "z-index": 1000,
            position: "relative",
            "box-shadow": "var(--shadow-md)"
          }}>
            <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
              <span style={{ "font-weight": "600", "font-size": "14px" }}>
                ⚠️ Unhandled Application Error Detected
              </span>
              <button
                class="btn btn-text"
                onClick={() => setGlobalError(null)}
                style={{
                  color: "var(--color-danger)",
                  border: "1px solid var(--color-danger)",
                  padding: "2px 8px",
                  "border-radius": "4px",
                  cursor: "pointer"
                }}
              >
                Dismiss
              </button>
            </div>
            <div style={{ "font-family": "var(--font-mono)", "font-size": "12px", "white-space": "pre-wrap", "word-break": "break-all" }}>
              {globalError()?.message}
              {globalError()?.stack && (
                <details style={{ "margin-top": "8px" }}>
                  <summary style={{ cursor: "pointer", "font-weight": "500" }}>View Stack Trace</summary>
                  <pre style={{ "margin-top": "6px", "max-height": "150px", overflow: "auto", padding: "8px", "background-color": "rgba(0,0,0,0.05)", "border-radius": "4px" }}>
                    {globalError()?.stack}
                  </pre>
                </details>
              )}
            </div>
          </div>
        </Show>

        <Show when={!uiStore.state.isSidebarOpen}>
          <button
            class="btn btn-text sidebar-expand-btn"
            onClick={() => uiStore.toggleSidebar()}
            title="Expand sidebar"
            style={{
              position: "absolute",
              top: "10px",
              left: "10px",
              padding: "6px",
              display: "inline-flex",
              "align-items": "center",
              "justify-content": "center",
              "z-index": 100
            }}
          >
            <Icon name="menu" size={18} />
          </button>
        </Show>

        <Show
          when={collectionsStore.activeCollection()}
          fallback={
            <div class="welcome-screen">
              <div class="welcome-logo">📂</div>
              <h1 class="welcome-title">Welcome to Collections</h1>
              <p class="welcome-subtitle">
                A modern Markdown note taking experience designed around your local files and folders.
                Create a collection to get started.
              </p>
              <div class="welcome-actions">
                <button
                  class="btn btn-primary"
                  onClick={() => {
                    setNewCollectionError("");
                    setIsNewCollectionOpen(true);
                  }}
                >
                  <Icon name="plus" size={16} />
                  New Collection
                </button>
              </div>

              <Show when={!uiStore.state.isSidebarOpen}>
                <div class="welcome-footer" style={{
                  position: "absolute",
                  bottom: "0",
                  left: "0",
                  right: "0",
                  padding: "16px 20px",
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "space-between",
                  "border-top": "1px solid var(--color-border)"
                }}>
                  <div class="user-profile" style={{ display: "flex", "align-items": "center", gap: "8px", "font-size": "13px", color: "var(--color-text-secondary)" }}>
                    <div class="user-avatar" style={{
                      width: "24px",
                      height: "24px",
                      "border-radius": "50%",
                      "background-color": "var(--color-accent)",
                      color: "#fff",
                      display: "flex",
                      "align-items": "center",
                      "justify-content": "center",
                      "font-size": "11px",
                      "font-weight": "600"
                    }}>C</div>
                    <span>Local Vault</span>
                  </div>
                  <button
                    class="btn btn-text"
                    onClick={() => setIsSettingsOpen(true)}
                    title="Settings"
                    style={{ padding: "4px" }}
                  >
                    <Icon name="settings" size={18} />
                  </button>
                </div>
              </Show>
            </div>
          }
        >
          <Show
            when={editorStore.state.openFilePath}
              fallback={
                <div class="info-panel" style={{ "padding-left": !uiStore.state.isSidebarOpen ? "48px" : "40px" }}>
                  <Show when={editorStore.state.error}>
                    <div class="editor-error-banner" style={{ "margin-bottom": "16px" }}>
                      <span>Error: {editorStore.state.error}</span>
                      <button class="btn-close" onClick={() => editorStore.closeFile()} style={{
                        background: "none",
                        border: "1px solid var(--color-danger)",
                        color: "var(--color-danger)",
                        padding: "2px 8px",
                        "border-radius": "4px",
                        cursor: "pointer",
                        "margin-left": "16px"
                      }}>
                        Clear
                      </button>
                    </div>
                  </Show>
                  <Show
                    when={getSelectedEntryInfo()}
                    fallback={
                      <div style={{
                        display: "flex",
                        "flex-direction": "column",
                        "align-items": "center",
                        "justify-content": "center",
                        flex: 1,
                        color: "var(--color-text-muted)"
                      }}>
                        <Icon name="file" size={48} style={{ opacity: 0.15, "margin-bottom": "16px" }} />
                        <span>Select a note from the tree to view details</span>
                      </div>
                    }
                  >
                    {(info) => (
                      <>
                        <div class="info-header">
                          <h2 class="info-title">{info().name}</h2>
                          <div class="info-meta">
                            <span class="meta-item">
                              <strong>Type:</strong> {info().type}
                            </span>
                          </div>
                        </div>

                        <div class="info-body">
                          <p>You have selected a file in the collection explorer.</p>
                          <div class="info-card">
                            <h4>File Details</h4>
                            <code>Path: {info().path}</code>
                            <code style={{ "margin-top": "8px" }}>ID: {info().id}</code>
                          </div>
                        </div>
                      </>
                    )}
                  </Show>
                </div>
              }
            >
              <Editor />
            </Show>
        </Show>
      </main>

      <Dialog
        isOpen={isNewCollectionOpen()}
        title="Create New Collection"
        type="input"
        placeholder="Collection name"
        errorMessage={newCollectionError()}
        onConfirm={handleCreateCollection}
        onClose={() => setIsNewCollectionOpen(false)}
      />

      <ThemePanel
        isOpen={isSettingsOpen()}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings()}
        onSettingsChange={setSettings}
      />

      <Dialog
        isOpen={isImportFolderNameOpen()}
        title="Import Folder: Choose Collection Name"
        type="input"
        defaultValue={importFolderPath().replace(/\\/g, "/").split("/").pop() || "Imported Vault"}
        placeholder="Collection name"
        errorMessage={importFolderNameError()}
        onConfirm={handleImportFolderConfirm}
        onClose={() => setIsImportFolderNameOpen(false)}
      />

      <ZipConflictDialog
        isOpen={isZipConflictOpen()}
        conflicts={zipConflicts()}
        onConfirm={handleZipConflictConfirm}
        onClose={() => setIsZipConflictOpen(false)}
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
    </div>
  );
}
