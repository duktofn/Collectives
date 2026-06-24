import { Show } from "solid-js";
import { editorStore } from "../../stores/editor";
import { uiStore } from "../../stores/ui";
import { Icon } from "../common/Icon";

export function EditorToolbar() {
  const getFileName = () => {
    const path = editorStore.state.openFilePath;
    if (!path) return "";
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1];
  };

  const getRelativePath = () => {
    return editorStore.state.openFilePath ?? "";
  };

  return (
    <div class="editor-toolbar">
      <div class="editor-title-container" style={{ "margin-left": !uiStore.state.isSidebarOpen ? "36px" : "0px", "transition": "margin-left var(--transition-normal)" }}>
        <Icon name="file" class="editor-file-icon" size={16} />
        <div class="editor-file-details">
          <span class="editor-file-name" title={getRelativePath()}>
            {getFileName()}
          </span>
          <Show when={editorStore.state.isReadOnly}>
            <span class="badge badge-readonly">Read Only</span>
          </Show>
        </div>
      </div>

      <div class="editor-actions">
        {/* Save indicator */}
        <Show when={!editorStore.state.isReadOnly}>
          <div class="editor-save-indicator">
            <Show
              when={editorStore.state.isSaving}
              fallback={
                <Show
                  when={editorStore.state.isDirty}
                  fallback={
                    <span class="status-dot status-saved" title="Saved to disk" />
                  }
                >
                  <span class="status-dot status-dirty" title="Unsaved changes (saving in 2s)" />
                </Show>
              }
            >
              <div class="status-spinner" title="Saving..." />
            </Show>
          </div>
        </Show>

        {/* Mode switcher segmented control */}
        <div class="editor-mode-selector">
          <button
            class="mode-btn"
            classList={{ active: editorStore.state.mode === "view" }}
            onClick={() => editorStore.setMode("view")}
            title="Read and view formatted output"
          >
            View
          </button>
          <Show when={!editorStore.state.isReadOnly}>
            <button
              class="mode-btn"
              classList={{ active: editorStore.state.mode === "edit-render" }}
              onClick={() => editorStore.setMode("edit-render")}
              title="WYSIWYG Markdown Editing"
            >
              Render
            </button>
            <button
              class="mode-btn"
              classList={{ active: editorStore.state.mode === "edit-source" }}
              onClick={() => editorStore.setMode("edit-source")}
              title="Raw Markdown Syntax"
            >
              Source
            </button>
          </Show>
        </div>


      </div>
    </div>
  );
}
