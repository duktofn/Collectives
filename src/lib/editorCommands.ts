import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

export type MarkdownTemplate = "heading" | "checklist" | "table" | "code" | "chart";

let templateInsertHandler: ((template: MarkdownTemplate) => boolean) | null = null;

export function registerMarkdownTemplateInsert(handler: (template: MarkdownTemplate) => boolean): () => void {
  templateInsertHandler = handler;
  return () => {
    if (templateInsertHandler === handler) templateInsertHandler = null;
  };
}

export function requestMarkdownTemplateInsert(template: MarkdownTemplate): boolean {
  return templateInsertHandler?.(template) ?? false;
}

export function buildMarkdownTemplateTransaction(
  view: EditorView,
  template: MarkdownTemplate,
  replacementRange: { from: number; to: number } = view.state.selection.main,
): { changes: { from: number; to: number; insert: string }; selection: { anchor: number }; effects: ReturnType<typeof EditorView.scrollIntoView> } | null {
  if (!view.state.facet(EditorView.editable)) return null;
  let current: SyntaxNode | null = syntaxTree(view.state).resolveInner(replacementRange.from, -1);
  while (current) {
    if (["FencedCode", "IndentedCode", "InlineCode"].includes(current.name)) return null;
    current = current.parent;
  }

  const templates: Record<MarkdownTemplate, string> = {
    heading: "## ",
    checklist: "- [ ] ",
    table: "| Column 1 | Column 2 |\n| --- | --- |\n|  |  |",
    code: "```text\n\n```",
    chart: "```chart\ntype: bar\ndata:\n  labels: []\n  datasets:\n    - label: Series\n      data: []\n```",
  };
  const insertion = templates[template];
  const isBlock = template === "table" || template === "code" || template === "chart";
  const before = isBlock && replacementRange.from > 0 && view.state.doc.sliceString(replacementRange.from - 1, replacementRange.from) !== "\n" ? "\n" : "";
  const after = isBlock && replacementRange.to < view.state.doc.length && view.state.doc.sliceString(replacementRange.to, replacementRange.to + 1) !== "\n" ? "\n" : "";
  const replacement = `${before}${insertion}${after}`;
  let cursorOffset = replacement.length;
  if (template === "heading") cursorOffset = before.length + insertion.length;
  if (template === "checklist") cursorOffset = before.length + insertion.length;
  if (template === "code") cursorOffset = before.length + insertion.indexOf("\n\n") + 1;
  if (template === "chart") cursorOffset = before.length + insertion.indexOf("type: bar") + "type: bar".length;
  if (template === "table") cursorOffset = before.length + insertion.length - 3;

  const cursor = replacementRange.from + cursorOffset;
  return {
    changes: { from: replacementRange.from, to: replacementRange.to, insert: replacement },
    selection: { anchor: cursor },
    effects: EditorView.scrollIntoView(cursor, { y: "center" }),
  };
}

export function insertMarkdownTemplate(view: EditorView, template: MarkdownTemplate): boolean {
  const transaction = buildMarkdownTemplateTransaction(view, template);
  if (!transaction) return false;
  view.dispatch(transaction);
  view.focus();
  return true;
}

