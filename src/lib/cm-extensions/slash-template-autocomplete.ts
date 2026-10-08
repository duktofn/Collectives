import type { Completion, CompletionContext } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { buildMarkdownTemplateTransaction, type MarkdownTemplate } from "../editorCommands";

const templates: Array<{ label: string; detail: string; template: MarkdownTemplate }> = [
  { label: "heading", detail: "Insert a level 2 heading", template: "heading" },
  { label: "checklist", detail: "Insert an unchecked task", template: "checklist" },
  { label: "table", detail: "Insert a two-column table", template: "table" },
  { label: "code", detail: "Insert a fenced code block", template: "code" },
  { label: "chart", detail: "Insert a chart block", template: "chart" },
];

export function slashTemplateCompletionSource(context: CompletionContext) {
  const line = context.state.doc.lineAt(context.pos);
  const beforeCursor = line.text.slice(0, context.pos - line.from);
  const match = beforeCursor.match(/(?:^|\s)\/[a-z-]*$/i);
  if (!match) return null;
  const slashOffset = (match.index ?? 0) + match[0].lastIndexOf("/");
  const from = line.from + slashOffset;
  let current: SyntaxNode | null = syntaxTree(context.state).resolveInner(from, -1);
  while (current) {
    if (["FencedCode", "IndentedCode", "InlineCode"].includes(current.name)) return null;
    current = current.parent;
  }

  const options: Completion[] = templates.map(({ label, detail, template }) => ({
    label,
    detail,
    type: "keyword",
    apply(view, _completion, completionFrom, to) {
      const transaction = buildMarkdownTemplateTransaction(view, template, { from: completionFrom, to });
      if (transaction) view.dispatch(transaction);
    },
  }));
  return { from, options, filter: false };
}

