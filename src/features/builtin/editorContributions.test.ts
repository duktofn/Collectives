import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorSessionKeyFacet, isEditorSessionCurrent } from "../../lib/cm-extensions/editor-session";
import {
  getBuiltinEditorCompletionExtension,
  getBuiltinEditorContributionExtensions,
  installBuiltinEditorContributions,
} from "./editorContributions";
import { requestDocumentFormat, requestMarkdownTemplateInsert } from "../../lib/editorCommands";
import type { BuiltinEditorContributionContext } from "./editorContributions";

const views: EditorView[] = [];
const cleanups: Array<() => void> = [];

function createContext(name: string, editable = true) {
  let current = true;
  let sessionKey = `${name}-session`;
  const view = new EditorView({
    state: EditorState.create({
      doc: "note",
      extensions: [
        EditorView.editable.of(editable),
        EditorState.readOnly.of(!editable),
      ],
    }),
    parent: document.body,
  });
  views.push(view);
  const insertMarkdownTemplate = vi.fn(() => true);
  const formatDocument = vi.fn(async (_candidate: EditorView, _key: string) => true);
  const context: BuiltinEditorContributionContext = {
    currentView: () => current ? view : null,
    currentSessionKey: () => sessionKey,
    isCurrent: (candidate, key) => current && candidate === view && key === sessionKey && candidate.dom.isConnected,
    isWritable: (candidate, key) => current
      && candidate === view
      && key === sessionKey
      && candidate.dom.isConnected
      && !candidate.state.readOnly
      && candidate.state.facet(EditorView.editable),
    insertMarkdownTemplate,
    formatDocument,
  };
  return {
    view,
    context,
    insertMarkdownTemplate,
    formatDocument,
    makeStale: () => { current = false; },
    setSessionKey: (value: string) => { sessionKey = value; },
  };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  for (const view of views.splice(0)) view.destroy();
});

describe("trusted built-in editor contributions", () => {
  it("binds chart actions to the EditorState session that rendered them", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "first note",
        extensions: [editorSessionKeyFacet.of("session-a")],
      }),
      parent: document.body,
    });
    views.push(view);

    expect(isEditorSessionCurrent(view, "session-a")).toBe(true);
    expect(isEditorSessionCurrent(view, "session-b")).toBe(false);

    view.setState(EditorState.create({
      doc: "second note",
      extensions: [editorSessionKeyFacet.of("session-b")],
    }));
    expect(isEditorSessionCurrent(view, "session-a")).toBe(false);
    expect(isEditorSessionCurrent(view, "session-b")).toBe(true);
  });

  it("keeps chart and note-link extensions in their existing modes and templates in editable modes", () => {
    const chartView = getBuiltinEditorContributionExtensions("chart", "view");
    const chartWrite = getBuiltinEditorContributionExtensions("chart", "edit-render");
    expect(chartView).toHaveLength(1);
    expect(chartWrite).toEqual(chartView);
    expect(getBuiltinEditorContributionExtensions("chart", "edit-source")).toEqual([]);
    expect(getBuiltinEditorContributionExtensions("note-links", "view")).toHaveLength(1);
    expect(getBuiltinEditorContributionExtensions("note-links", "edit-render")).toHaveLength(1);
    expect(getBuiltinEditorCompletionExtension("view")).toBeUndefined();
    expect(getBuiltinEditorCompletionExtension("edit-source")).toBeDefined();
    expect(getBuiltinEditorCompletionExtension("edit-render")).toBeDefined();
  });

  it("routes commands to the newest view and restores the previous owner on replacement cleanup", async () => {
    const first = createContext("first");
    const disposeFirst = installBuiltinEditorContributions(first.context);
    cleanups.push(disposeFirst);
    const second = createContext("second");
    const disposeSecond = installBuiltinEditorContributions(second.context);
    cleanups.push(disposeSecond);

    expect(requestMarkdownTemplateInsert("heading")).toBe(true);
    expect(second.insertMarkdownTemplate).toHaveBeenCalledExactlyOnceWith(second.view, "second-session", "heading");
    expect(first.insertMarkdownTemplate).not.toHaveBeenCalled();
    await expect(requestDocumentFormat()).resolves.toBe(true);
    expect(second.formatDocument).toHaveBeenCalledExactlyOnceWith(second.view, "second-session");
    expect(first.formatDocument).not.toHaveBeenCalled();

    disposeSecond();
    expect(requestMarkdownTemplateInsert("table")).toBe(true);
    expect(first.insertMarkdownTemplate).toHaveBeenCalledExactlyOnceWith(first.view, "first-session", "table");
    await expect(requestDocumentFormat()).resolves.toBe(true);
    expect(first.formatDocument).toHaveBeenCalledExactlyOnceWith(first.view, "first-session");

    disposeFirst();
    expect(requestMarkdownTemplateInsert("heading")).toBe(false);
    await expect(requestDocumentFormat()).resolves.toBe(false);
  });

  it("does not commit a format result after the editor session is replaced", async () => {
    const writable = createContext("current");
    const disposeWritable = installBuiltinEditorContributions(writable.context);
    cleanups.push(disposeWritable);
    let finishFormat!: () => void;
    writable.formatDocument.mockImplementation(async (view, sessionKey) => {
      await new Promise<void>((resolve) => { finishFormat = resolve; });
      return writable.context.isCurrent(view, sessionKey) && writable.context.isWritable(view, sessionKey);
    });
    const pendingFormat = requestDocumentFormat();
    writable.setSessionKey("replaced-session");
    finishFormat();
    await expect(pendingFormat).resolves.toBe(false);
    expect(writable.formatDocument).toHaveBeenCalledExactlyOnceWith(writable.view, "current-session");
    disposeWritable();
  });

  it("refuses commands for a stale or read-only view and becomes inert after dispose", async () => {
    const stale = createContext("stale");
    const disposeStale = installBuiltinEditorContributions(stale.context);
    cleanups.push(disposeStale);
    stale.makeStale();
    expect(requestMarkdownTemplateInsert("checklist")).toBe(false);
    await expect(requestDocumentFormat()).resolves.toBe(false);
    expect(stale.insertMarkdownTemplate).not.toHaveBeenCalled();
    expect(stale.formatDocument).not.toHaveBeenCalled();
    disposeStale();

    const readOnly = createContext("read-only", false);
    const disposeReadOnly = installBuiltinEditorContributions(readOnly.context);
    cleanups.push(disposeReadOnly);
    expect(requestMarkdownTemplateInsert("heading")).toBe(false);
    await expect(requestDocumentFormat()).resolves.toBe(false);
    expect(readOnly.insertMarkdownTemplate).not.toHaveBeenCalled();
    expect(readOnly.formatDocument).not.toHaveBeenCalled();
    disposeReadOnly();

    expect(requestMarkdownTemplateInsert("checklist")).toBe(false);
    await expect(requestDocumentFormat()).resolves.toBe(false);
  });
});
