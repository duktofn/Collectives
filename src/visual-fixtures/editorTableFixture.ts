import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { baseEditorExtensions, getExtensionsForMode } from "../lib/cm-extensions/markdown-mode";

export const TABLE_INTERACTION_DOCUMENT = [
  "Editable table fixture.",
  "",
  "| Name | Formatting | Code sample |",
  "| :--- | :---: | ---: |",
  "| **bold text** | _italic text_ | `left|right` |",
  "| Escaped \\| pipe | plain | an intentionally long table cell to exercise horizontal scrolling |",
  "",
  "```md",
  "| example | this is code, not a table |",
  "| --- | --- |",
  "```",
].join("\n");

export function mountTableInteractionFixture(target: HTMLElement, mode: "edit-render" | "view" = "edit-render"): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc: TABLE_INTERACTION_DOCUMENT,
      extensions: [...baseEditorExtensions, ...getExtensionsForMode(mode)],
    }),
    parent: target,
  });
  (window as unknown as { __tableInteractionView?: EditorView }).__tableInteractionView = view;
  return view;
}
