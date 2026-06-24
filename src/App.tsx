import { createSignal, Show, createEffect } from "solid-js";
import { collectionsStore } from "./stores/collections";
import { uiStore } from "./stores/ui";
import { Sidebar } from "./components/sidebar/Sidebar";
import { CollectionTree } from "./components/tree/CollectionTree";
import { Dialog } from "./components/common/Dialog";
import { Icon } from "./components/common/Icon";
import { Entry, ZipConflict } from "./types";
import { editorStore } from "./stores/editor";
import { Editor } from "./components/editor/Editor";
import * as api from "./lib/tauri";
import { ZipConflictDialog } from "./components/common/ZipConflictDialog";
import "./App.css";


export default function App() {
  const [isNewCollectionOpen, setIsNewCollectionOpen] = createSignal(false);
  const [newCollectionError, setNewCollectionError] = createSignal("");

  const [isSettingsOpen, setIsSettingsOpen] = createSignal(false);

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
        const folderName = selected.replace(/\\/g, "/").split("/").pop() || "Imported Vault";
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

  createEffect(() => {
    if (editorStore.state.openFilePath === null) {
      const info = getSelectedEntryInfo();
      if (info && (info.type === "file" || info.type === "file (inside folder-ref)")) {
        uiStore.selectEntry(null);
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
            </div>
          }
        >
          {(col) => (
            <div style={{ display: "flex", width: "100%", height: "100%" }}>
              <CollectionTree collection={col()} />

              <Show
                when={editorStore.state.openFilePath}
                fallback={
                  <div class="info-panel">
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
            </div>
          )}
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

      <Dialog
        isOpen={isSettingsOpen()}
        title="Settings"
        type="confirm"
        onConfirm={() => setIsSettingsOpen(false)}
        onClose={() => setIsSettingsOpen(false)}
      >
        <div style={{ display: "flex", "flex-direction": "column", gap: "16px", "font-size": "13px" }}>
          <div>
            <strong>Theme Preference:</strong>
            <p style={{ color: "var(--color-text-secondary)", "margin-top": "4px" }}>
              App follows your system preference (Dark / Light mode).
            </p>
          </div>
          <div>
            <strong>Design System:</strong>
            <p style={{ color: "var(--color-text-secondary)", "margin-top": "4px" }}>
              Claude-inspired warm sand tones.
            </p>
          </div>
          <div>
            <strong>About:</strong>
            <p style={{ color: "var(--color-text-secondary)", "margin-top": "4px" }}>
              Collection-based Markdown Note App v0.1.0
            </p>
          </div>
        </div>
      </Dialog>

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
    </div>
  );
}
