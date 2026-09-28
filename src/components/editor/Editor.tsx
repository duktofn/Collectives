import { onMount, onCleanup, createEffect, on, createUniqueId, Show } from "solid-js";
import { EditorView } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { editorStore } from "../../stores/editor";
import { modeCompartment, getExtensionsForMode, getBaseExtensionsForFile } from "../../lib/cm-extensions/markdown-mode";
import { navigateToFragment } from "../../lib/wikilink/resolver";
import { registerEditorMeasureRequest } from "../../lib/editorMeasure";
import "./Editor.css";

export function Editor() {
  let editorRef: HTMLDivElement | undefined;
  let view: EditorView | undefined;
  let autoSaveTimeout: ReturnType<typeof setTimeout> | null = null;
  let forceSaveTimeout: ReturnType<typeof setTimeout> | null = null;
  let unregisterMeasure: (() => void) | undefined;
  let resizeObserver: ResizeObserver | undefined;
  const contentAttributesCompartment = new Compartment();
  const baseCompartment = new Compartment();
  const helpId = `editor-help-${createUniqueId()}`;

  const fileName = () => {
    const path = editorStore.state.openFilePath;
    return path ? path.split(/[/\\]/).pop() || path : "untitled document";
  };

  const modeDescription = () => {
    if (editorStore.state.fileKind === "text-source") return "text-source mode";
    if (editorStore.state.mode === "view") return "Markdown render mode";
    if (editorStore.state.mode === "edit-source") return "Markdown source mode";
    return "Markdown edit mode";
  };

  const requestSave = () => {
    void editorStore.saveFile().catch(() => {
      // The store keeps the draft and exposes the failure in its error banner.
    });
  };

  const contentAttributes = () => EditorView.contentAttributes.of({
    "aria-label": `${fileName()} — ${modeDescription()}`,
    "aria-readonly": editorStore.state.isReadOnly ? "true" : "false",
    "aria-describedby": helpId,
  });

  onMount(() => {
    if (!editorRef) return;

    // Create CM6 Editor View
    const startState = EditorState.create({
      doc: editorStore.state.currentContent,
      extensions: [
        baseCompartment.of(getBaseExtensionsForFile(editorStore.state.fileKind)),
        contentAttributesCompartment.of(contentAttributes()),
        modeCompartment.of(getExtensionsForMode(editorStore.state.mode, editorStore.state.fileKind)),
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
              requestSave();
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

    unregisterMeasure = registerEditorMeasureRequest(() => {
      view?.requestMeasure();
    });

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        view?.requestMeasure();
      });
      resizeObserver.observe(view.dom);
    }
  });

  onCleanup(() => {
    unregisterMeasure?.();
    resizeObserver?.disconnect();
    if (view) {
      view.destroy();
    }
    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
    }
    if (forceSaveTimeout) {
      clearTimeout(forceSaveTimeout);
    }
    // Critical saves are owned by App/window-close and selection transitions;
    // component cleanup only cancels timers and listeners.
  });

  // Reconfigure extensions when editor mode changes
  createEffect(
    on(
      () => `${editorStore.state.mode}:${editorStore.state.fileKind ?? "markdown"}`,
      (modeKey) => {
        if (view) {
          const [mode, kind] = modeKey.split(":") as ["view" | "edit-source" | "edit-render", "markdown" | "text-source"];
          view.dispatch({
            effects: [
              baseCompartment.reconfigure(getBaseExtensionsForFile(kind)),
              modeCompartment.reconfigure(getExtensionsForMode(mode, kind)),
            ],
          });
          view.requestMeasure();
        }
      },
      { defer: true }
    )
  );

  createEffect(
    on(
      () => `${editorStore.state.openFilePath ?? ""}:${editorStore.state.mode}:${editorStore.state.fileKind ?? "markdown"}:${editorStore.state.isReadOnly}`,
      () => {
        view?.dispatch({ effects: contentAttributesCompartment.reconfigure(contentAttributes()) });
      },
      { defer: true },
    ),
  );

  // Listen to openFilePath changes to load new content
  createEffect(
    on(
      () => [editorStore.state.generation, editorStore.state.openFileContent],
      () => {
        if (view && view.state.doc.toString() !== editorStore.state.currentContent) {
          view.dispatch({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: editorStore.state.currentContent,
            },
          });
        }
      },
      { defer: true }
    )
  );

  // Debounced auto-save effect with 15-second force save limit
  createEffect(() => {
    const isDirty = editorStore.state.isDirty;
    const isReadOnly = editorStore.state.isReadOnly;
    void editorStore.state.currentContent; // depend on content to run on every keystroke

    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
      autoSaveTimeout = null;
    }

    if (isDirty && !isReadOnly) {
      autoSaveTimeout = setTimeout(() => {
        if (forceSaveTimeout) {
          clearTimeout(forceSaveTimeout);
          forceSaveTimeout = null;
        }
        requestSave();
      }, 2000); // 2 seconds delay

      if (!forceSaveTimeout) {
        forceSaveTimeout = setTimeout(() => {
          if (autoSaveTimeout) {
            clearTimeout(autoSaveTimeout);
            autoSaveTimeout = null;
          }
          forceSaveTimeout = null;
          requestSave();
        }, 15000); // 15 seconds force save limit
      }
    } else {
      if (forceSaveTimeout) {
        clearTimeout(forceSaveTimeout);
        forceSaveTimeout = null;
      }
    }
  });

  // Handle pending navigation (scrolling to heading/block refs)
  createEffect(() => {
    const nav = editorStore.state.pendingNavigation;
    if (nav && view) {
      navigateToFragment(view, nav);
      editorStore.clearPendingNavigation();
    }
  });

  return (
    <div class="editor-container">
      {editorStore.state.error && (
        <div class="editor-error-banner">
          <span>Error: {editorStore.state.error}</span>
          <Show when={editorStore.state.conflictKind === null}>
            <button class="btn-close" onClick={requestSave}>
              Retry save
            </button>
          </Show>
          <Show when={editorStore.state.conflictKind === "file" && editorStore.state.isDirty}>
            <button class="btn-close" disabled={editorStore.state.isSaving} onClick={async () => { await editorStore.overwriteExternalVersion(); }}>
              Overwrite disk version
            </button>
          </Show>
          <button class="btn-close" onClick={async () => { await editorStore.reloadAndDiscard(); }}>
            Reload and discard local draft
          </button>
          <button class="btn-close" onClick={async () => { await editorStore.closeFile(); }}>
            Close
          </button>
        </div>
      )}
      <p id={helpId} class="ds-visually-hidden">
        {editorStore.state.isReadOnly ? "Read-only document." : "Editable document."} Use standard text editing keys. {modeDescription()} preserves Markdown and text-source source positions.
      </p>
      <div class="editor-workspace" ref={editorRef} />
    </div>
  );
}
