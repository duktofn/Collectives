import { Prec, Extension, Transaction, type TransactionSpec } from "@codemirror/state";
import { EditorView, KeyBinding, keymap } from "@codemirror/view";
import { insertNewlineAndIndent, isolateHistory, moveLineDown, moveLineUp } from "@codemirror/commands";
import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import { isCursorInFencedCode } from "./code-block-widget";
import { inlineFormattingAt } from './inline-formatting';
import { editorModeFacet } from './facet';
import {
  canRunFormatting,
  indentListItem,
  toggleCodeBlock,
  toggleLinePrefix,
  toggleWrap,
} from "./formatting-utils";

function inFencedCode(view: EditorView): boolean {
  return isCursorInFencedCode(view.state, view.state.selection.main.head);
}

function runWhenFormattingAllowed(
  view: EditorView,
  action: (view: EditorView) => boolean
): boolean {
  if (!canRunFormatting(view)) return false;
  if (inFencedCode(view)) return false;
  return action(view);
}

function finishInlineFormattingOnEnter(view: EditorView): boolean {
  const state = view.state;
  if (state.readOnly || view.composing || state.facet(editorModeFacet) !== 'edit-render'
    || state.selection.ranges.length !== 1 || !state.selection.main.empty) return false;
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const spans = inlineFormattingAt(state, head);
  // Empty emphasis pairs have no inline syntax node (**** is a rule).
  if (!spans.length && !isCursorInFencedCode(state, head)) {
    const before = state.doc.sliceString(line.from, head);
    const after = state.doc.sliceString(head, line.to);
    const openTo = head - before.match(/[\t ]*$/)![0].length;
    const closeFrom = head + after.match(/^[\t ]*/)![0].length;
    for (const marker of ['***', '**', '__', '~~', '*', '_']) {
      const from = openTo - marker.length;
      const to = closeFrom + marker.length;
      if (from < line.from || to > line.to) continue;
      if (state.doc.sliceString(from, openTo) !== marker || state.doc.sliceString(closeFrom, to) !== marker
        || (from > line.from && state.doc.sliceString(from - 1, from) === marker[0])
        || state.doc.sliceString(to, to + 1) === marker[0]
        || (state.doc.sliceString(line.from, from).match(/\\+$/)?.[0].length ?? 0) % 2) continue;
      spans.push({ name: 'StrongEmphasis', from, to, openTo, closeFrom, draft: true });
      break;
    }
  }
  const span = spans
    .filter((span) => span.name !== 'InlineCode' && span.from >= line.from
      && span.to <= line.to && head >= span.openTo && head <= span.closeFrom
      && /^[\t ]*$/.test(state.doc.sliceString(span.to, line.to))
      && [...state.doc.sliceString(head, span.to)].every((char, index) => /[\t ]/.test(char)
        || spans.some((other) => head + index >= other.closeFrom && head + index < other.to)))
    .sort((a, b) => a.from - b.from)[0];
  if (!span) return false;

  const content = state.doc.sliceString(span.openTo, head);
  const whitespace = content.match(/[\t ]*$/)![0];
  const empty = content.trim().length === 0;
  const prepared: TransactionSpec = empty ? {
    changes: { from: span.from, to: span.to, insert: '' },
    selection: { anchor: span.from },
  } : {
    changes: { from: head - whitespace.length, to: span.to,
      insert: state.doc.sliceString(head, span.to).replace(/[\t ]/g, '') + whitespace
        + state.doc.sliceString(head, span.to).replace(/[^\t ]/g, '') },
    selection: { anchor: line.to },
  };
  const intermediate = state.update(prepared).state;
  const target = {
    state: intermediate,
    dispatch: (newline: Transaction) => view.dispatch(state.update(prepared, {
      changes: newline.changes, selection: newline.selection, effects: newline.effects, sequential: true,
      annotations: [Transaction.userEvent.of('input'), isolateHistory.of('full')], scrollIntoView: true,
    })),
  };
  return insertNewlineContinueMarkup(target) || insertNewlineAndIndent(target);
}

const formattingBindings: KeyBinding[] = [
  {
    key: "Mod-b",
    run: (view) => runWhenFormattingAllowed(view, (v) => toggleWrap(v, "**", "**")),
  },
  {
    key: "Mod-i",
    run: (view) =>
      runWhenFormattingAllowed(view, (v) => toggleWrap(v, "*", "*", { singleChar: true })),
  },
  {
    key: "Mod-`",
    run: (view) => toggleCodeBlock(view),
  },
  {
    key: "Mod-Shift-s",
    run: (view) => runWhenFormattingAllowed(view, (v) => toggleWrap(v, "~~", "~~")),
  },
  {
    key: "Mod-Shift-7",
    run: (view) => runWhenFormattingAllowed(view, (v) => toggleLinePrefix(v, "ordered")),
  },
  {
    key: "Mod-Shift-8",
    run: (view) => runWhenFormattingAllowed(view, (v) => toggleLinePrefix(v, "unordered")),
  },
  {
    key: "Mod-Shift->",
    run: (view) => runWhenFormattingAllowed(view, (v) => toggleLinePrefix(v, "blockquote")),
  },
];

const listIndentKeymap: KeyBinding[] = [
  {
    key: "Tab",
    run: (view) => {
      if (!canRunFormatting(view)) return false;
      return indentListItem(view, 2);
    },
  },
  {
    key: "Shift-Tab",
    run: (view) => {
      if (!canRunFormatting(view)) return false;
      return indentListItem(view, -2);
    },
  },
];

const lineMoveKeymap: KeyBinding[] = [
  {
    key: "Alt-ArrowUp",
    preventDefault: true,
    run: (view) => {
      const moved = moveLineUp(view);
      if (moved) view.requestMeasure();
      return moved;
    },
  },
  {
    key: "Alt-ArrowDown",
    preventDefault: true,
    run: (view) => {
      const moved = moveLineDown(view);
      if (moved) view.requestMeasure();
      return moved;
    },
  },
];

export const formattingKeymapExtension: Extension = [
  Prec.highest(keymap.of([{ key: 'Enter', run: (view) => view.state.readOnly || finishInlineFormattingOnEnter(view) }])),
  Prec.highest(keymap.of(lineMoveKeymap)),
  keymap.of(formattingBindings),
  Prec.high(keymap.of(listIndentKeymap)),
];
