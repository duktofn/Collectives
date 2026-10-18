import { syntaxTree } from '@codemirror/language';
import { isolateHistory } from '@codemirror/commands';
import { EditorState, Transaction } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { parser, Strikethrough } from '@lezer/markdown';
import { editorModeFacet } from './facet';

export const inlineClasses: Readonly<Record<string, string>> = {
  StrongEmphasis: 'cm-strong',
  Emphasis: 'cm-emphasis',
  InlineCode: 'cm-inline-code',
  Strikethrough: 'cm-strikethrough',
};

export interface InlineFormatting {
  name: string;
  from: number;
  to: number;
  openTo: number;
  closeFrom: number;
  draft: boolean;
}

const draftParser = parser.configure(Strikethrough);
const opaqueNodes = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'CommentBlock', 'HTMLTag', 'LinkResource', 'URL', 'Escape', 'Table']);

function formatting(node: SyntaxNode, offset: number, draft: boolean): InlineFormatting | null {
  if (!inlineClasses[node.name]) return null;
  const opening = node.firstChild;
  const closing = node.lastChild;
  if (!opening || !closing || opening === closing || !opening.name.endsWith('Mark') || !closing.name.endsWith('Mark')) return null;
  return { name: node.name, from: node.from + offset, to: node.to + offset,
    openTo: opening.to + offset, closeFrom: closing.from + offset, draft };
}

/** Native inline spans plus active drafts invalidated only by whitespace before their closer. */
export function inlineFormattingAt(state: EditorState, position: number): InlineFormatting[] {
  const tree = syntaxTree(state);
  const line = state.doc.lineAt(position);
  const spans: InlineFormatting[] = [];
  let opaque = false;
  for (let node: SyntaxNode | null = tree.resolveInner(position, -1); node; node = node.parent) {
    if (opaqueNodes.has(node.name)) opaque = true;
  }
  tree.iterate({ from: line.from, to: line.to, enter(node) {
    if (node.from >= position || node.to < position) return;
    const span = formatting(node.node, 0, false);
    if (span) spans.push(span);
  } });
  if (opaque) return spans;

  // A same-length projection lets Lezer validate the actual delimiter pairing,
  // escaping, nesting, and code/link exclusions. The saved text is never changed.
  for (const match of line.text.matchAll(/[\t ]+([*_]{1,3}|~{2})(?![*_~])/g)) {
    const end = match.index + match[0].length;
    if (line.from + end < position) continue;
    const closingStart = end - match[1].length;
    const whitespaceEnd = closingStart - 1;
    const projected = line.text.slice(0, whitespaceEnd) + 'x' + line.text.slice(closingStart);
    draftParser.parse(projected).iterate({ enter(node) {
      if (opaqueNodes.has(node.name)) return false;
      if (node.from >= whitespaceEnd || node.to <= closingStart || node.to > end) return;
      const span = formatting(node.node, line.from, true);
      if (!span || span.from >= position || span.to < position) return;
      if (spans.some((other) => other.name === span.name && other.from <= span.from && other.to >= span.to)) return;
      spans.push(span);
    } });
  }
  return spans;
}

/** Commit trailing whitespace outside the delimiters when the caret leaves a draft. */
export const inlineFormattingExitExtension = EditorState.transactionFilter.of((transaction) => {
  if (transaction.docChanged || !transaction.selection || transaction.startState.readOnly
    || transaction.startState.facet(editorModeFacet) !== 'edit-render'
    || transaction.state.facet(editorModeFacet) !== 'edit-render'
    || transaction.startState.selection.ranges.length !== 1 || transaction.newSelection.ranges.length !== 1
    || !transaction.startState.selection.main.empty || !transaction.newSelection.main.empty) return transaction;
  const before = transaction.startState.selection.main.head;
  const after = transaction.newSelection.main.head;
  const spans = inlineFormattingAt(transaction.startState, before);
  const draft = spans
    .filter((span) => span.draft && (after >= span.to || after <= span.from))
    .sort((a, b) => a.from - b.from)[0];
  if (!draft) return transaction;
  const whitespaceStarts = spans.filter((span) => span.from >= draft.from && span.to <= draft.to)
    .flatMap((span) => {
      const content = transaction.startState.doc.sliceString(span.openTo, span.closeFrom);
      const whitespace = content.match(/[\t ]+$/)?.[0];
      return whitespace && content.trim() ? [span.closeFrom - whitespace.length] : [];
    });
  if (!whitespaceStarts.length) return transaction;
  const from = Math.min(...whitespaceStarts);
  const suffix = transaction.startState.doc.sliceString(from, draft.to);
  if (!/^[*_~\t ]+$/.test(suffix)) return transaction;
  return [transaction, {
    changes: { from, to: draft.to,
      insert: suffix.replace(/[\t ]/g, '') + suffix.replace(/[^\t ]/g, '') },
    selection: transaction.newSelection,
    sequential: true,
    annotations: [Transaction.userEvent.of('input'), isolateHistory.of('full')],
  }];
});
