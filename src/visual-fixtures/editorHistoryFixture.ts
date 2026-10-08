import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { baseEditorExtensions, getExtensionsForMode } from "../lib/cm-extensions/markdown-mode";

const modeSlot = new Compartment();

export function mountHistoryFixture(target: HTMLElement): EditorView {
  const createState = (doc: string) => EditorState.create({
    doc,
    extensions: [...baseEditorExtensions, modeSlot.of(getExtensionsForMode("edit-render"))],
  });
  const view = new EditorView({
    state: createState([
      "Edit this prose line.",
      "",
      "```ts",
      "const selected = true;",
      "```",
    ].join("\n")),
    parent: target,
  });
  (window as unknown as {
    __historyFixture?: {
      view: EditorView;
      setMode: (mode: "view" | "edit-source" | "edit-render") => void;
      openDocument: (doc: string) => void;
    };
  }).__historyFixture = {
    view,
    setMode(mode) {
      view.dispatch({ effects: modeSlot.reconfigure(getExtensionsForMode(mode)) });
    },
    openDocument(doc) {
      view.setState(createState(doc));
    },
  };
  return view;
}
