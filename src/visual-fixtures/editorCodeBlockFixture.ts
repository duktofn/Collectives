import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { baseEditorExtensions, getExtensionsForMode } from "../lib/cm-extensions/markdown-mode";

export const CODE_BLOCK_INTERACTION_DOCUMENT = [
  "Before the first code block.",
  "",
  "```typescript",
  "const greeting = \"Xin chào 🌱\";",
  "\tconsole.log(greeting);",
  "const longLine = \"0123456789abcdefghijklmnopqrstuvwxyz\".repeat(8);",
  "```",
  "",
  "```text",
  "last line in the second block",
  "```",
  "",
  "After both code blocks.",
].join("\n");

export function mountCodeBlockInteractionFixture(
  target: HTMLElement,
  mode: "edit-render" | "view" = "edit-render",
): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc: CODE_BLOCK_INTERACTION_DOCUMENT,
      extensions: [...baseEditorExtensions, ...getExtensionsForMode(mode)],
    }),
    parent: target,
  });
  (window as unknown as { __codeBlockInteractionView?: EditorView }).__codeBlockInteractionView = view;
  return view;
}
