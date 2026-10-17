import { Facet, StateEffect, type EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

const documentKind = Facet.define<'code' | 'markdown', 'code' | 'markdown'>({
  combine: (values) => values[0] ?? 'markdown',
});
const refreshOccurrences = StateEffect.define<null>();
const wordCharacter = /[\p{L}\p{N}_$]/u;

function codeAt(state: EditorState, position: number): boolean {
  if (state.facet(documentKind) === 'code') return true;
  let node = syntaxTree(state).resolve(position, 1);
  while (node) {
    if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name)) return true;
    if (!node.parent) break;
    node = node.parent;
  }
  return false;
}

function occurrences(view: EditorView): DecorationSet {
  const { state } = view;
  const enabled = (code: boolean) =>
    document.documentElement.dataset[code ? 'highlightCode' : 'highlightMarkdown'] !== 'false';
  const selection = state.selection.main;
  if (state.selection.ranges.length !== 1 || !enabled(codeAt(state, selection.head)))
    return Decoration.none;
  const active = selection.empty ? state.wordAt(selection.head) : selection;
  if (!active) return Decoration.none;
  const word = state.sliceDoc(active.from, active.to);
  if (!word || word.length > 256 || !/^[\p{L}\p{N}_$]+$/u.test(word)) return Decoration.none;
  const marks: { from: number; to: number; value: Decoration }[] = [];
  for (const range of view.visibleRanges) {
    const from = Math.max(0, range.from - word.length);
    const text = state.sliceDoc(from, Math.min(state.doc.length, range.to + word.length));
    let index = text.indexOf(word);
    while (index >= 0) {
      const start = from + index,
        end = start + word.length;
      const previous = Array.from(state.sliceDoc(Math.max(0, start - 2), start)).pop() ?? '';
      const next = Array.from(state.sliceDoc(end, Math.min(state.doc.length, end + 2)))[0] ?? '';
      if (
        start >= range.from &&
        end <= range.to &&
        !wordCharacter.test(previous) &&
        !wordCharacter.test(next) &&
        enabled(codeAt(state, start))
      ) {
        marks.push({
          from: start,
          to: end,
          value: Decoration.mark({ class: 'cm-word-occurrence' }),
        });
      }
      index = text.indexOf(word, index + word.length);
    }
  }
  return Decoration.set(marks, true);
}

const highlightOccurrences = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    observer: MutationObserver;
    timer?: ReturnType<typeof setTimeout>;
    constructor(view: EditorView) {
      this.decorations = occurrences(view);
      this.observer = new MutationObserver(() => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => view.dispatch({ effects: refreshOccurrences.of(null) }), 0);
      });
      this.observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-highlight-code', 'data-highlight-markdown'],
      });
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state) ||
        update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(refreshOccurrences))
        )
      )
        this.decorations = occurrences(update.view);
    }
    destroy() {
      this.observer.disconnect();
      clearTimeout(this.timer);
    }
  },
  { decorations: (plugin) => plugin.decorations }
);

export function wordOccurrenceHighlighting(kind: 'code' | 'markdown'): Extension {
  return [documentKind.of(kind), highlightOccurrences];
}
