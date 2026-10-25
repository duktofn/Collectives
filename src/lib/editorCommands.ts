import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

type BaseMarkdownTemplate = 'heading' | 'checklist' | 'table' | 'code' | 'chart';
export type MarkdownTemplate =
  | BaseMarkdownTemplate
  | `chart-${import('./charts/chartModel').ChartKind}`;

let noteSearchHandler: ((query: string) => void) | null = null;

export interface EditorCommandHandlers {
  insertMarkdownTemplate: (template: MarkdownTemplate) => boolean;
  formatDocument: () => Promise<boolean>;
}

const editorCommandInstallations: Array<{ handlers: EditorCommandHandlers }> = [];

export function registerNoteContentSearch(handler: (query: string) => void): () => void {
  noteSearchHandler = handler;
  return () => {
    if (noteSearchHandler === handler) noteSearchHandler = null;
  };
}

export function requestNoteContentSearch(query = ''): void {
  noteSearchHandler?.(query);
}

export function installEditorCommandHandlers(handlers: EditorCommandHandlers): () => void {
  const installation = { handlers };
  editorCommandInstallations.push(installation);
  return () => {
    const index = editorCommandInstallations.indexOf(installation);
    if (index >= 0) editorCommandInstallations.splice(index, 1);
  };
}

export function requestDocumentFormat(): Promise<boolean> {
  return editorCommandInstallations[editorCommandInstallations.length - 1]?.handlers.formatDocument()
    ?? Promise.resolve(false);
}

export function requestMarkdownTemplateInsert(template: MarkdownTemplate): boolean {
  return editorCommandInstallations[editorCommandInstallations.length - 1]?.handlers.insertMarkdownTemplate(template)
    ?? false;
}

export function buildMarkdownTemplateTransaction(
  view: EditorView,
  template: MarkdownTemplate,
  replacementRange: { from: number; to: number } = view.state.selection.main
): {
  changes: { from: number; to: number; insert: string };
  selection: { anchor: number };
  effects: ReturnType<typeof EditorView.scrollIntoView>;
} | null {
  if (view.state.readOnly || !view.state.facet(EditorView.editable)) return null;
  const chartKind = template.startsWith('chart-') ? template.slice(6) : 'bar';
  const base = template.startsWith('chart-') ? 'chart' : (template as BaseMarkdownTemplate);
  let current: SyntaxNode | null = syntaxTree(view.state).resolveInner(replacementRange.from, -1);
  while (current) {
    if (['FencedCode', 'IndentedCode', 'InlineCode'].includes(current.name)) return null;
    current = current.parent;
  }

  const templates: Record<BaseMarkdownTemplate, string> = {
    heading: '## ',
    checklist: '- [ ] ',
    table: '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |',
    code: '```text\n\n```',
    chart: `\`\`\`chart\ntype: ${chartKind}\ndata:\n  labels: [A, B, C]\n  datasets:\n    - label: Series\n      data: [3, 7, 5]\n\`\`\``,
  };
  const insertion = templates[base];
  const isBlock = base === 'table' || base === 'code' || base === 'chart';
  const before =
    isBlock &&
    replacementRange.from > 0 &&
    view.state.doc.sliceString(replacementRange.from - 1, replacementRange.from) !== '\n'
      ? '\n'
      : '';
  let after =
    isBlock &&
    replacementRange.to < view.state.doc.length &&
    view.state.doc.sliceString(replacementRange.to, replacementRange.to + 1) !== '\n'
      ? '\n'
      : '';
  if (base === 'chart') {
    const following = view.state.doc.sliceString(replacementRange.to, replacementRange.to + 2);
    after = following.startsWith('\n\n') ? '' : following.startsWith('\n') ? '\n' : '\n\n';
  }
  const replacement = `${before}${insertion}${after}`;
  let cursorOffset = replacement.length;
  if (template === 'heading') cursorOffset = before.length + insertion.length;
  if (template === 'checklist') cursorOffset = before.length + insertion.length;
  if (template === 'code') cursorOffset = before.length + insertion.indexOf('\n\n') + 1;
  if (base === 'chart') cursorOffset = before.length + insertion.length + 2;
  if (template === 'table') cursorOffset = before.length + insertion.length - 3;

  const cursor = replacementRange.from + cursorOffset;
  return {
    changes: { from: replacementRange.from, to: replacementRange.to, insert: replacement },
    selection: { anchor: cursor },
    effects: EditorView.scrollIntoView(cursor, { y: 'center' }),
  };
}

export function insertMarkdownTemplate(view: EditorView, template: MarkdownTemplate): boolean {
  const transaction = buildMarkdownTemplateTransaction(view, template);
  if (!transaction) return false;
  view.dispatch(transaction);
  view.focus();
  return true;
}

export function setMarkdownHeading(view: EditorView, level: 1 | 2 | 3): boolean {
  if (!buildMarkdownTemplateTransaction(view, 'heading')) return false;
  const selection = view.state.selection.main;
  const first = view.state.doc.lineAt(selection.from);
  const last = view.state.doc.lineAt(
    selection.to > selection.from ? selection.to - 1 : selection.to
  );
  const changes = [];
  for (let number = first.number; number <= last.number; number++) {
    const line = view.state.doc.line(number);
    if (!buildMarkdownTemplateTransaction(view, 'heading', { from: line.from, to: line.from }))
      return false;
    const prefix = line.text.match(/^#{1,6}(?:[ \t]+|$)/)?.[0] ?? '';
    changes.push({
      from: line.from,
      to: line.from + prefix.length,
      insert: '#'.repeat(level) + ' ',
    });
  }
  const changeSet = view.state.changes(changes);
  view.dispatch({
    changes: changeSet,
    selection: {
      anchor: changeSet.mapPos(selection.anchor, 1),
      head: changeSet.mapPos(selection.head, 1),
    },
    userEvent: 'input.heading',
  });
  view.focus();
  return true;
}
