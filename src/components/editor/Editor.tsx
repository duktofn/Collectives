import { onMount, onCleanup, createEffect, on } from "solid-js";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { editorStore } from "../../stores/editor";
import { EditorToolbar } from "./EditorToolbar";
import { modeCompartment, getExtensionsForMode } from "../../lib/cm-extensions/markdown-mode";
import "./Editor.css";

export function Editor() {
  let editorRef: HTMLDivElement | undefined;
  let view: EditorView | undefined;
  let autoSaveTimeout: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    if (!editorRef) return;

    // Create CM6 Editor View
    const startState = EditorState.create({
      doc: editorStore.state.currentContent,
      extensions: [
        modeCompartment.of(getExtensionsForMode(editorStore.state.mode)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            editorStore.updateContent(update.state.doc.toString());
          }
        }),
        // Add custom Ctrl+S binding inside the editor
        EditorView.domEventHandlers({
          keydown(event) {
            if ((event.ctrlKey || event.metaKey) && event.key === "s") {
              event.preventDefault();
              editorStore.saveFile();
              return true;
            }
            return false;
          },
        }),
      ],
    });

    view = new EditorView({
      state: startState,
      parent: editorRef,
    });
  });

  onCleanup(() => {
    if (view) {
      view.destroy();
    }
    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
    }
  });

  // Reconfigure extensions when editor mode changes
  createEffect(() => {
    const mode = editorStore.state.mode;
    if (view) {
      view.dispatch({
        effects: modeCompartment.reconfigure(getExtensionsForMode(mode)),
      });
    }
  });

  // Listen to openFilePath changes to load new content
  createEffect(
    on(
      () => editorStore.state.openFilePath,
      () => {
        if (view) {
          view.dispatch({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: editorStore.state.currentContent,
            },
          });
        }
      }
    )
  );

  // Debounced auto-save effect
  createEffect(() => {
    const isDirty = editorStore.state.isDirty;
    const isReadOnly = editorStore.state.isReadOnly;

    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
      autoSaveTimeout = null;
    }

    if (isDirty && !isReadOnly) {
      autoSaveTimeout = setTimeout(() => {
        editorStore.saveFile();
      }, 2000); // 2 seconds delay
    }
  });

  return (
    <div class="editor-container">
      <EditorToolbar />
      {editorStore.state.error && (
        <div class="editor-error-banner">
          <span>Error: {editorStore.state.error}</span>
          <button class="btn-close" onClick={() => editorStore.closeFile()}>
            Close
          </button>
        </div>
      )}
      <div class="editor-workspace" ref={editorRef} />
    </div>
  );
}
