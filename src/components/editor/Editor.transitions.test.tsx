import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { undo } from "@codemirror/commands";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Editor } from "./Editor";
import { editorStore } from "../../stores/editor";
import * as api from "../../features/editor";

vi.mock("../../features/editor", () => ({
  readFile: vi.fn(async (path: string) => ({ content: "# Heading", versionToken: path, fileKind: path.endsWith(".md") ? "markdown" : "text-source" })),
  writeFile: vi.fn(async () => undefined),
  asSafetyError: vi.fn(() => null),
}));

beforeEach(async () => { await editorStore.closeFile(true); vi.clearAllMocks(); });
afterEach(cleanup);

it("reconfigures the parser when switching Markdown and source files in the same view", async () => {
  await editorStore.openFile("note.md");
  render(() => <Editor />);
  const view = EditorView.findFromDOM(document.querySelector(".cm-editor")!)!;
  expect(syntaxTree(view.state).toString()).toContain("ATXHeading");
  await editorStore.openFile("script.ts");
  await waitFor(() => expect(syntaxTree(view.state).toString()).not.toContain("ATXHeading"));
  await editorStore.openFile("note.md");
  await waitFor(() => expect(syntaxTree(view.state).toString()).toContain("ATXHeading"));
});

it("updates the mounted view when reloading the same path", async () => {
  await editorStore.openFile("note.md");
  render(() => <Editor />);
  const view = EditorView.findFromDOM(document.querySelector(".cm-editor")!)!;
  vi.mocked(api.readFile).mockResolvedValueOnce({ content: "External content", versionToken: "new" });
  expect(await editorStore.reloadAndDiscard()).toBe(true);
  await waitFor(() => expect(view.state.doc.toString()).toBe("External content"));
  expect(editorStore.state.isDirty).toBe(false);
});

it("retains the current document and undo history when opening another file fails", async () => {
  await editorStore.openFile("note.md");
  render(() => <Editor />);
  const view = EditorView.findFromDOM(document.querySelector(".cm-editor")!)!;
  view.dispatch({ changes: { from: view.state.doc.length, insert: "\nLocal edit" } });
  await editorStore.saveFile();
  const previousState = view.state;
  vi.mocked(api.readFile).mockRejectedValueOnce(new Error("next file is unavailable"));
  await expect(editorStore.openFile("missing.md")).rejects.toThrow("unavailable");
  expect(editorStore.state.error).toBeNull();
  expect(view.state).toBe(previousState);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("# Heading");
});
