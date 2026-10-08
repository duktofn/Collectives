import { render } from "solid-js/web";
import { EditorView } from "@codemirror/view";
import { Editor } from "../components/editor/Editor";
import { editorStore } from "../stores/editor";
import { uiStore } from "../stores/ui";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
  }
}

export async function mountEditorPerformanceFixture(target: HTMLElement, content: string) {
  window.__TAURI_INTERNALS__ = {
    invoke: async (command, _args) => {
      if (command === "read_file") return { content, versionToken: "performance-fixture-token", fileKind: "markdown" };
      if (command === "write_file") return { versionToken: "performance-fixture-token" };
      if (command === "create_file") return { versionToken: "performance-copy-token" };
      if (command === "search_link_index") return [];
      return undefined;
    },
  };
  uiStore.selectEntry(null);
  await editorStore.openFile("C:/performance/one-megabyte-note.md");
  const dispose = render(() => <Editor />, target);
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const contentElement = target.querySelector<HTMLElement>(".cm-content");
  const view = contentElement ? EditorView.findFromDOM(contentElement) : undefined;
  if (!view) throw new Error("CodeMirror view failed to mount in the performance fixture");
  return {
    view,
    switchPath: (path: string) => editorStore.openFile(path),
    dispose: async () => {
      dispose();
      await editorStore.closeFile(true);
    },
  };
}

