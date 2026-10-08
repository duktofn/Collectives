import { onMount, onCleanup, createEffect, on, createUniqueId, Show, For, createSignal } from "solid-js";
import { EditorView } from "@codemirror/view";
import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state";
import { editorStore } from "../../stores/editor";
import { modeCompartment, getExtensionsForMode, getBaseExtensionsForFile } from "../../lib/cm-extensions/markdown-mode";
import { navigateToFragment } from "../../lib/wikilink/resolver";
import { registerEditorMeasureRequest } from "../../lib/editorMeasure";
import { ModalLayer } from "../common/ModalLayer";
import { Icon } from "../common/Icon";
import * as editorApi from "../../features/editor";
import * as collectionsApi from "../../stores/collections";
import { saveDocumentDialog } from "../../platform";
import { uiStore } from "../../stores/ui";
import { searchNoteContent } from "../../features/links";
import { syntaxTree } from "@codemirror/language";
import type { ContentSearchResult } from "../../shared/ipc/client";
import { insertMarkdownTemplate, registerMarkdownTemplateInsert } from "../../lib/editorCommands";
import type { MarkdownTemplate } from "../../lib/editorCommands";
import "./Editor.css";

interface ComparedDiskVersion {
  content: string;
  versionToken: string;
}

interface OutlineHeading {
  level: number;
  title: string;
  lineNumber: number;
  from: number;
}

const externalContentSync = Annotation.define<boolean>();

export function Editor() {
  let editorRef: HTMLDivElement | undefined;
  let view: EditorView | undefined;
  let autoSaveTimeout: ReturnType<typeof setTimeout> | null = null;
  let forceSaveTimeout: ReturnType<typeof setTimeout> | null = null;
  let unregisterMeasure: (() => void) | undefined;
  let unregisterContentReader: (() => void) | undefined;
  let unregisterTemplateInsert: (() => void) | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let documentSessionKey: string | undefined;
  let documentViewStateKey: string | null = null;
  const documentViewStates = new Map<string, { anchor: number; head: number; scrollTop: number; scrollLeft: number }>();
  let outlineTimer: ReturnType<typeof setTimeout> | undefined;
  let backlinkRequestId = 0;
  const contentAttributesCompartment = new Compartment();
  const baseCompartment = new Compartment();
  const helpId = `editor-help-${createUniqueId()}`;
  const compareTitleId = `editor-conflict-compare-${createUniqueId()}`;
  const [isCompareOpen, setIsCompareOpen] = createSignal(false);
  const [isComparing, setIsComparing] = createSignal(false);
  const [compareError, setCompareError] = createSignal("");
  const [comparedDiskVersion, setComparedDiskVersion] = createSignal<ComparedDiskVersion | null>(null);
  const [comparedDraft, setComparedDraft] = createSignal("");
  const [isCopying, setIsCopying] = createSignal(false);
  const [copyMessage, setCopyMessage] = createSignal("");
  const [conflictNoticeDismissed, setConflictNoticeDismissed] = createSignal(false);
  const [outlineHeadings, setOutlineHeadings] = createSignal<OutlineHeading[]>([]);
  const [referenceTab, setReferenceTab] = createSignal<"outline" | "backlinks">("outline");
  const referenceId = `note-tools-${createUniqueId()}`;
  const handleReferenceTabKeys = (event: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "outline" : event.key === "End" ? "backlinks" : referenceTab() === "outline" ? "backlinks" : "outline";
    setReferenceTab(next);
    document.getElementById(`${referenceId}-${next}-tab`)?.focus();
  };
  const [backlinks, setBacklinks] = createSignal<ContentSearchResult[]>([]);
  const [backlinksLoading, setBacklinksLoading] = createSignal(false);
  const [backlinksError, setBacklinksError] = createSignal("");

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

  createEffect(() => {
    if (editorStore.state.conflictKind === null) setConflictNoticeDismissed(false);
  });

  const compareCurrentVersions = async () => {
    const path = editorStore.state.openFilePath;
    if (!path) return;
    setIsComparing(true);
    setCompareError("");
    setComparedDraft(editorStore.getCurrentContent());
    try {
      const raw = await editorApi.readFile(path);
      const disk = typeof raw === "string" ? { content: raw, versionToken: "" } : raw;
      setComparedDiskVersion({ content: disk.content, versionToken: disk.versionToken });
    } catch (error) {
      setComparedDiskVersion(null);
      setCompareError(`Could not read the current disk version. The original may have moved or been removed. ${String(error)}`);
    } finally {
      setIsComparing(false);
    }
  };

  const openCompare = async () => {
    setIsCompareOpen(true);
    await compareCurrentVersions();
  };

  const saveDraftCopy = async () => {
    const path = editorStore.state.openFilePath;
    if (!path) return;
    const parts = path.split(/[\\/]/);
    const originalName = parts.pop() || "draft.md";
    const dot = originalName.lastIndexOf(".");
    const defaultName = dot > 0
      ? `${originalName.slice(0, dot)} (copy)${originalName.slice(dot)}`
      : `${originalName} (copy)`;
    const directory = parts.join("/");
    const target = await saveDocumentDialog("Save a copy of this draft", directory ? `${directory}/${defaultName}` : defaultName);
    if (!target) return;
    setIsCopying(true);
    setCopyMessage("");
    try {
      const saved = await editorStore.saveDraftCopy(target);
      if (!saved) throw new Error(editorStore.state.error || "Could not save the copy");
      try {
        const selectedId = uiStore.state.selectedEntryId;
        const parentGroupId = selectedId ? collectionsApi.collectionsStore.getParentGroupId(selectedId) ?? undefined : undefined;
        await collectionsApi.collectionsStore.addFiles([target], parentGroupId);
        setCopyMessage(`Copy saved and added to this collection: ${target}`);
      } catch (error) {
        setCopyMessage(`Copy saved at ${target}, but it could not be added to this collection: ${String(error)}`);
      }
    } catch (error) {
      setCopyMessage(`Could not save a copy: ${String(error)}`);
    } finally {
      setIsCopying(false);
    }
  };

  const overwriteComparedVersion = async () => {
    const compared = comparedDiskVersion();
    if (!compared) return;
    const saved = await editorStore.overwriteExternalVersion(compared.versionToken);
    if (saved) {
      setIsCompareOpen(false);
      setConflictNoticeDismissed(false);
    } else if (editorStore.state.error) {
      setCompareError(editorStore.state.error);
    }
  };

  const rebuildOutline = () => {
    if (!view) return;
    const headings: OutlineHeading[] = [];
    syntaxTree(view.state).iterate({
      enter(node) {
        const match = node.name.match(/^(?:ATX|Setext)Heading([1-6])$/);
        if (!match || headings.length >= 500) return;
        const raw = view?.state.doc.sliceString(node.from, node.to) ?? "";
        const firstLine = raw.split(/\r?\n/, 1)[0] ?? "";
        const title = firstLine.replace(/^#{1,6}\s*/, "").trim();
        if (!title) return;
        headings.push({ level: Number(match[1]), title, lineNumber: view!.state.doc.lineAt(node.from).number, from: node.from });
      },
    });
    setOutlineHeadings(headings);
  };

  const refreshBacklinks = async () => {
    const collectionId = collectionsApi.collectionsStore.state.activeCollectionId;
    const path = editorStore.state.openFilePath;
    const name = editorStore.currentFileName;
    if (!collectionId || !path || !name) {
      setBacklinks([]);
      return;
    }
    const requestId = ++backlinkRequestId;
    setBacklinksLoading(true);
    setBacklinksError("");
    try {
      const page = await searchNoteContent(collectionId, `[[${name}`, 0, 100);
      if (requestId !== backlinkRequestId) return;
      setBacklinks(page.results.filter((item) => item.path.toLowerCase() !== path.toLowerCase()));
      if (page.truncated) setBacklinksError("The scan reached its safety limit; refresh after narrowing the collection.");
    } catch (error) {
      if (requestId === backlinkRequestId) {
        setBacklinks([]);
        setBacklinksError(`Could not search backlinks: ${String(error)}`);
      }
    } finally {
      if (requestId === backlinkRequestId) setBacklinksLoading(false);
    }
  };

  const openBacklink = async (item: ContentSearchResult) => {
    const selected = await editorStore.selectEntry(item.entryId);
    if (!selected) return;
    if (editorStore.state.openFilePath !== item.path) await editorStore.openFile(item.path);
  };

  const contentAttributes = () => EditorView.contentAttributes.of({
    "aria-label": `${fileName()} — ${modeDescription()}`,
    "aria-readonly": editorStore.state.isReadOnly ? "true" : "false",
    "aria-describedby": helpId,
  });

  const saveDocumentViewState = (path: string | null) => {
    if (!path || !view) return;
    const selection = view.state.selection.main;
    documentViewStates.delete(path);
    documentViewStates.set(path, {
      anchor: selection.anchor,
      head: selection.head,
      scrollTop: view.scrollDOM.scrollTop,
      scrollLeft: view.scrollDOM.scrollLeft,
    });
    while (documentViewStates.size > 24) {
      const oldest = documentViewStates.keys().next().value;
      if (oldest === undefined) break;
      documentViewStates.delete(oldest);
    }
  };

  const restoreDocumentViewState = (path: string | null) => {
    if (!path || !view) return;
    const saved = documentViewStates.get(path);
    if (!saved) return;
    const anchor = Math.min(saved.anchor, view.state.doc.length);
    const head = Math.min(saved.head, view.state.doc.length);
    view.dispatch({ selection: { anchor, head }, annotations: Transaction.addToHistory.of(false) });
    requestAnimationFrame(() => {
      if (!view || documentViewStateKey !== path) return;
      view.scrollDOM.scrollTop = saved.scrollTop;
      view.scrollDOM.scrollLeft = saved.scrollLeft;
    });
  };

  const createEditorState = (doc: string) => EditorState.create({
    doc,
    extensions: [
      baseCompartment.of(getBaseExtensionsForFile(editorStore.state.fileKind)),
      contentAttributesCompartment.of(contentAttributes()),
      modeCompartment.of(getExtensionsForMode(editorStore.state.mode, editorStore.state.fileKind)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(externalContentSync))) {
          editorStore.markContentChanged();
        }
      }),
      EditorView.domEventHandlers({
        keydown(event) {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            requestSave();
            return true;
          }
          return false;
        },
      }),
    ],
  });

  onMount(() => {
    if (!editorRef) return;

    view = new EditorView({
      state: createEditorState(editorStore.state.currentContent),
      parent: editorRef,
    });
    unregisterContentReader = editorStore.registerCurrentContentReader(() => view?.state.doc.toString() ?? "");
    unregisterTemplateInsert = registerMarkdownTemplateInsert((template: MarkdownTemplate) => view ? insertMarkdownTemplate(view, template) : false);
    documentSessionKey = `${editorStore.state.generation}:${editorStore.state.openFilePath ?? ""}`;
    documentViewStateKey = editorStore.state.openFilePath;

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
    unregisterContentReader?.();
    unregisterTemplateInsert?.();
    resizeObserver?.disconnect();
    if (view) {
      saveDocumentViewState(documentViewStateKey);
      view.destroy();
    }
    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
    }
    if (forceSaveTimeout) {
      clearTimeout(forceSaveTimeout);
    }
    if (outlineTimer) clearTimeout(outlineTimer);
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
      () => `${editorStore.state.generation}:${editorStore.state.openFilePath ?? ""}`,
      (sessionKey) => {
        if (!view || documentSessionKey === sessionKey) return;
        saveDocumentViewState(documentViewStateKey);
        documentSessionKey = sessionKey;
        documentViewStateKey = editorStore.state.openFilePath;
        view.setState(createEditorState(editorStore.state.currentContent));
        restoreDocumentViewState(documentViewStateKey);
        view.requestMeasure();
      },
      { defer: true },
    ),
  );

  createEffect(
    on(
      () => [editorStore.state.generation, editorStore.state.openFileContent],
      () => {
        if (view && !editorStore.state.isDirty && editorStore.state.conflictKind === null && view.state.doc.toString() !== editorStore.getCurrentContent()) {
          view.dispatch({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: editorStore.getCurrentContent(),
            },
            annotations: [Transaction.addToHistory.of(false), externalContentSync.of(true)],
          });
        }
      },
      { defer: true }
    )
  );

  createEffect(() => {
    const isOpen = uiStore.state.isReferencePanelOpen;
    void editorStore.state.revision;
    void editorStore.state.generation;
    if (!isOpen) {
      if (outlineTimer) clearTimeout(outlineTimer);
      return;
    }
    if (outlineTimer) clearTimeout(outlineTimer);
    outlineTimer = setTimeout(rebuildOutline, 160);
  });

  createEffect(on(
    () => [
      uiStore.state.isReferencePanelOpen,
      referenceTab(),
      collectionsApi.collectionsStore.state.activeCollectionId,
      editorStore.state.openFilePath,
      editorStore.state.versionToken,
    ] as const,
    ([isOpen, tab]) => {
      if (isOpen && tab === "backlinks") void refreshBacklinks();
      else backlinkRequestId += 1;
    },
    { defer: true },
  ));

  // Debounced auto-save effect with 15-second force save limit
  createEffect(() => {
    const isDirty = editorStore.state.isDirty;
    const isReadOnly = editorStore.state.isReadOnly;
    const hasConflict = editorStore.state.conflictKind !== null;
    void editorStore.state.revision; // keystrokes advance the revision without serializing the full document

    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
      autoSaveTimeout = null;
    }

    if (isDirty && !isReadOnly && !hasConflict) {
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

  createEffect(() => {
    const position = editorStore.state.pendingSearchPosition;
    const openPath = editorStore.state.openFilePath;
    if (!position || !view || !openPath || position.path !== openPath) return;
    const line = view.state.doc.line(Math.min(position.lineNumber, view.state.doc.lines));
    const cursor = Math.min(line.to, line.from + position.columnUtf16);
    view.dispatch({
      selection: { anchor: cursor },
      effects: EditorView.scrollIntoView(cursor, { y: "center" }),
      annotations: Transaction.addToHistory.of(false),
    });
    view.focus();
    editorStore.clearPendingSearchPosition();
  });

  return (
    <div class="editor-container">
      {(editorStore.state.error || (editorStore.state.conflictKind && !conflictNoticeDismissed())) && (
        <div class="editor-error-banner">
          <span>
            {editorStore.state.conflictKind === "file"
              ? `Conflict: the disk version changed. Your draft is preserved.${editorStore.state.error ? ` ${editorStore.state.error}` : ""}`
              : editorStore.state.error ? `Save status: ${editorStore.state.error}` : ""}
          </span>
          <Show when={editorStore.state.conflictKind === null}>
            <button class="btn-close" onClick={requestSave}>
              Retry save
            </button>
          </Show>
          <Show when={editorStore.state.conflictKind === "file" && editorStore.state.isDirty}>
            <button class="btn-close" disabled={editorStore.state.isSaving || isCopying()} onClick={() => void saveDraftCopy()}>
              {isCopying() ? "Saving copy…" : "Save a copy"}
            </button>
            <button class="btn-close" disabled={editorStore.state.isSaving || isComparing()} onClick={() => void openCompare()}>
              Compare versions
            </button>
            <button class="btn-close" disabled={editorStore.state.isSaving} onClick={() => {
              editorStore.keepEditing();
              setConflictNoticeDismissed(true);
            }}>
              Keep editing
            </button>
          </Show>
          <button class="btn-close" onClick={async () => { await editorStore.reloadAndDiscard(); }}>
            Reload disk version and discard this draft
          </button>
        </div>
      )}
      <Show when={copyMessage()}>
        <div class="editor-copy-message" role="status">{copyMessage()}</div>
      </Show>
      <p id={helpId} class="ds-visually-hidden">
        {editorStore.state.isReadOnly ? "Read-only document." : "Editable document."} Use standard text editing keys. {modeDescription()} preserves Markdown and text-source source positions.
      </p>
      <div class="editor-main-layout">
        <div class="editor-workspace" ref={editorRef} />
        <Show when={uiStore.state.isReferencePanelOpen}>
          <aside class="editor-reference-panel" aria-label="Outline and backlinks">
            <div class="editor-reference-header">
              <strong>This note</strong>
              <button class="btn btn-text" aria-label="Close note tools" onClick={() => { uiStore.setReferencePanelOpen(false); document.querySelector<HTMLButtonElement>('button[aria-label="Outline and backlinks"]')?.focus(); }}><Icon name="close" size={16} /></button>
            </div>
            <div class="editor-reference-tabs" role="tablist" aria-label="Note tools" onKeyDown={handleReferenceTabKeys}>
              <button id={`${referenceId}-outline-tab`} aria-controls={`${referenceId}-outline-panel`} role="tab" tabIndex={referenceTab() === "outline" ? 0 : -1} aria-selected={referenceTab() === "outline" ? "true" : "false"} classList={{ active: referenceTab() === "outline" }} onClick={() => setReferenceTab("outline")}>Outline</button>
              <button id={`${referenceId}-backlinks-tab`} aria-controls={`${referenceId}-backlinks-panel`} role="tab" tabIndex={referenceTab() === "backlinks" ? 0 : -1} aria-selected={referenceTab() === "backlinks" ? "true" : "false"} classList={{ active: referenceTab() === "backlinks" }} onClick={() => setReferenceTab("backlinks")}>Backlinks</button>
            </div>
            <Show when={referenceTab() === "outline"}>
              <div id={`${referenceId}-outline-panel`} role="tabpanel" aria-labelledby={`${referenceId}-outline-tab`} class="editor-outline-list">
                <For each={outlineHeadings()}>
                  {(heading) => <button class="editor-outline-item" style={{ "--outline-depth": heading.level - 1 }} title={heading.title} onClick={() => {
                    if (!view) return;
                    const position = Math.min(heading.from, view.state.doc.length);
                    view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: "center" }) });
                    view.focus();
                  }}><span>{heading.title}</span><small>{heading.lineNumber}</small></button>}
                </For>
                <Show when={outlineHeadings().length === 0}><p class="editor-reference-empty">No headings in this note yet.</p></Show>
              </div>
            </Show>
            <Show when={referenceTab() === "backlinks"}>
              <div id={`${referenceId}-backlinks-panel`} role="tabpanel" aria-labelledby={`${referenceId}-backlinks-tab`} class="editor-backlinks-panel">
                <button class="editor-backlinks-refresh" disabled={backlinksLoading()} onClick={() => void refreshBacklinks()}>{backlinksLoading() ? "Searching…" : "Refresh backlinks"}</button>
                <Show when={backlinksLoading()}><p role="status">Searching this collection in the background…</p></Show>
                <Show when={backlinksError()}><p class="editor-reference-error" role="alert">{backlinksError()}</p></Show>
                <For each={backlinks()}>
                  {(item) => <button class="editor-backlink-item" onClick={() => void openBacklink(item)} title={item.path}>
                    <strong>{item.displayName}</strong>
                    <small>{item.path}</small>
                    <span>{item.snippet}</span>
                  </button>}
                </For>
                <Show when={!backlinksLoading() && !backlinksError() && backlinks().length === 0}><p class="editor-reference-empty">No backlinks found.</p></Show>
              </div>
            </Show>
          </aside>
        </Show>
      </div>
      <ModalLayer
        isOpen={isCompareOpen()}
        labelledBy={compareTitleId}
        overlayClass="editor-compare-backdrop"
        contentClass="editor-compare-dialog"
        onClose={() => setIsCompareOpen(false)}
        pending={isComparing() || editorStore.state.isSaving}
      >
        <div class="editor-compare-header">
          <div>
            <h2 id={compareTitleId}>Compare local draft with disk</h2>
            <p>Your draft stays open. Review both versions before choosing what to keep.</p>
          </div>
          <button class="btn btn-text" disabled={isComparing()} onClick={() => void compareCurrentVersions()}>Refresh comparison</button>
        </div>
        <Show when={compareError()}>
          <div class="editor-compare-error" role="alert">{compareError()}</div>
        </Show>
        <Show when={isComparing()}><p role="status">Reading the current disk version…</p></Show>
        <Show when={comparedDiskVersion()}>
          {(disk) => <>
            <p class="editor-compare-result" role="status">
              {comparedDraft() === disk().content ? "The draft and disk currently match." : "The draft and disk differ. Review both versions below."}
            </p>
            <div class="editor-compare-columns">
              <label>
                <span>Your local draft</span>
                <textarea readOnly value={comparedDraft()} aria-label="Your local draft" />
              </label>
              <label>
                <span>Current disk version</span>
                <textarea readOnly value={disk().content} aria-label="Current disk version" />
              </label>
            </div>
            <div class="editor-compare-actions">
              <button class="btn btn-text" onClick={() => setIsCompareOpen(false)}>Keep editing</button>
              <button class="btn btn-primary" disabled={editorStore.state.isSaving || comparedDraft() === disk().content} onClick={() => void overwriteComparedVersion()}>
                Overwrite this compared version
              </button>
            </div>
          </>}
        </Show>
      </ModalLayer>
    </div>
  );
}
