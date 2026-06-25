import { EditorState, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export type LinePrefixKind = "ordered" | "unordered" | "blockquote";

const LIST_LINE = /^(\s*)([-*+]|\d+\.)\s/;
const ORDERED_PREFIX = /^(\s*)(\d+\.\s)/;
const UNORDERED_PREFIX = /^(\s*)([-*+]\s)/;
const BLOCKQUOTE_PREFIX = /^(\s*)(>\s?)/;

export function isListLine(text: string): boolean {
  return LIST_LINE.test(text);
}

function prefixRegex(kind: LinePrefixKind): RegExp {
  switch (kind) {
    case "ordered":
      return ORDERED_PREFIX;
    case "unordered":
      return UNORDERED_PREFIX;
    case "blockquote":
      return BLOCKQUOTE_PREFIX;
  }
}

function prefixInsert(kind: LinePrefixKind): string {
  switch (kind) {
    case "ordered":
      return "1. ";
    case "unordered":
      return "- ";
    case "blockquote":
      return "> ";
  }
}

export interface WrapOptions {
  /** For single-char markers like italic * — avoid matching ** bold. */
  singleChar?: boolean;
}

export function isWrappedBy(
  doc: EditorState["doc"],
  from: number,
  to: number,
  open: string,
  close: string,
  options?: WrapOptions
): boolean {
  if (from < open.length || to + close.length > doc.length) return false;
  if (doc.sliceString(from - open.length, from) !== open) return false;
  if (doc.sliceString(to, to + close.length) !== close) return false;

  if (options?.singleChar) {
    const charBeforeOpen = from - open.length - 1;
    const charAfterClose = to + close.length;
    if (charBeforeOpen >= 0 && doc.sliceString(charBeforeOpen, from - open.length) === open) {
      return false;
    }
    if (charAfterClose < doc.length && doc.sliceString(to + close.length, charAfterClose + close.length) === close) {
      return false;
    }
  }

  return true;
}

export function isEmptyPairAt(
  doc: EditorState["doc"],
  pos: number,
  open: string,
  close: string
): boolean {
  return (
    pos >= open.length &&
    pos + close.length <= doc.length &&
    doc.sliceString(pos - open.length, pos) === open &&
    doc.sliceString(pos, pos + close.length) === close
  );
}

export function buildToggleWrapSpec(
  state: EditorState,
  open: string,
  close: string,
  options?: WrapOptions
): TransactionSpec | null {
  const { from, to } = state.selection.main;

  if (from === to) {
    if (isEmptyPairAt(state.doc, from, open, close)) {
      return {
        changes: [
          { from: from - open.length, to: from, insert: "" },
          { from: from, to: from + close.length, insert: "" },
        ],
        selection: { anchor: from - open.length },
      };
    }

    return {
      changes: { from, to, insert: open + close },
      selection: { anchor: from + open.length },
    };
  }

  if (isWrappedBy(state.doc, from, to, open, close, options)) {
    return {
      changes: [
        { from: from - open.length, to: from, insert: "" },
        { from: to, to: to + close.length, insert: "" },
      ],
      selection: { anchor: from - open.length, head: to - open.length },
    };
  }

  return {
    changes: { from, to, insert: open + state.doc.sliceString(from, to) + close },
    selection: { anchor: from + open.length + (to - from) + close.length },
  };
}

export function toggleWrap(
  view: EditorView,
  open: string,
  close: string,
  options?: WrapOptions
): boolean {
  const spec = buildToggleWrapSpec(view.state, open, close, options);
  if (!spec) return false;
  view.dispatch(view.state.update(spec));
  return true;
}

function lineNumbersInSelection(state: EditorState): { fromLine: number; toLine: number } {
  const sel = state.selection.main;
  const fromLine = state.doc.lineAt(sel.from).number;
  const toLine = state.doc.lineAt(sel.to).number;
  return { fromLine, toLine: Math.max(fromLine, toLine) };
}

export function buildLinePrefixSpec(state: EditorState, kind: LinePrefixKind): TransactionSpec | null {
  const { fromLine, toLine } = lineNumbersInSelection(state);
  const regex = prefixRegex(kind);
  const lines: { line: number; text: string; from: number }[] = [];

  for (let n = fromLine; n <= toLine; n++) {
    const line = state.doc.line(n);
    lines.push({ line: n, text: line.text, from: line.from });
  }

  if (lines.length === 0) return null;

  const allHavePrefix = lines.every(({ text }) => regex.test(text));
  const changes: { from: number; to: number; insert: string }[] = [];

  for (const { text, from } of lines) {
    const match = text.match(regex);
    if (allHavePrefix && match) {
      changes.push({
        from: from + match[1].length,
        to: from + match[1].length + match[2].length,
        insert: "",
      });
    } else if (!allHavePrefix && !match) {
      changes.push({
        from,
        to: from,
        insert: prefixInsert(kind),
      });
    }
  }

  if (changes.length === 0) return null;
  return { changes };
}

export function toggleLinePrefix(view: EditorView, kind: LinePrefixKind): boolean {
  const spec = buildLinePrefixSpec(view.state, kind);
  if (!spec) return false;
  view.dispatch(view.state.update(spec));
  return true;
}

export function buildListIndentSpec(state: EditorState, delta: 2 | -2): TransactionSpec | null {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  if (!isListLine(line.text)) return null;

  if (delta > 0) {
    return {
      changes: { from: line.from, to: line.from, insert: "  " },
      selection: { anchor: head + 2 },
    };
  }

  if (!line.text.startsWith("  ")) return null;
  return {
    changes: { from: line.from, to: line.from + 2, insert: "" },
    selection: { anchor: Math.max(line.from, head - 2) },
  };
}

export function indentListItem(view: EditorView, delta: 2 | -2): boolean {
  const spec = buildListIndentSpec(view.state, delta);
  if (!spec) return false;
  view.dispatch(view.state.update(spec));
  return true;
}

export function canRunFormatting(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  return true;
}

function isFenceLine(text: string): boolean {
  return text.trimStart().startsWith("```");
}

export interface FencedBlockRange {
  openLine: { from: number; to: number; number: number };
  closeLine: { from: number; to: number; number: number };
}

export function findEnclosingFencedBlock(
  state: EditorState,
  from: number,
  to: number
): FencedBlockRange | null {
  const fenceLines: number[] = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    if (isFenceLine(state.doc.line(n).text)) {
      fenceLines.push(n);
    }
  }

  if (fenceLines.length < 2) return null;

  const selStartLine = state.doc.lineAt(from).number;
  const selEndLine = state.doc.lineAt(to > from ? to - 1 : to).number;

  let best: FencedBlockRange | null = null;

  for (let i = 0; i < fenceLines.length - 1; i++) {
    const openNum = fenceLines[i];
    const closeNum = fenceLines[i + 1];
    if (closeNum <= openNum) continue;
    if (selStartLine < openNum || selEndLine > closeNum) continue;

    const openLine = state.doc.line(openNum);
    const closeLine = state.doc.line(closeNum);
    const candidate: FencedBlockRange = {
      openLine: { from: openLine.from, to: openLine.to, number: openNum },
      closeLine: { from: closeLine.from, to: closeLine.to, number: closeNum },
    };

    if (
      !best ||
      closeNum - openNum < best.closeLine.number - best.openLine.number
    ) {
      best = candidate;
    }
  }

  return best;
}

function extractFencedInnerContent(state: EditorState, block: FencedBlockRange): string {
  let innerFrom = block.openLine.to + 1;
  let innerTo = block.closeLine.from;

  while (innerFrom < innerTo && state.doc.sliceString(innerFrom, innerFrom + 1) === "\n") {
    innerFrom += 1;
  }
  while (innerTo > innerFrom && state.doc.sliceString(innerTo - 1, innerTo) === "\n") {
    innerTo -= 1;
  }

  return state.doc.sliceString(innerFrom, innerTo);
}

export function buildToggleCodeBlockSpec(state: EditorState): TransactionSpec {
  const { from, to } = state.selection.main;
  const block = findEnclosingFencedBlock(state, from, to);

  if (block) {
    const inner = extractFencedInnerContent(state, block);
    const blockFrom = block.openLine.from;
    const blockTo = block.closeLine.to;
    return {
      changes: { from: blockFrom, to: blockTo, insert: inner },
      selection: { anchor: blockFrom, head: blockFrom + inner.length },
    };
  }

  if (from === to) {
    const insert = "```\n\n```";
    return {
      changes: { from, to, insert },
      selection: { anchor: from + 4 },
    };
  }

  const selected = state.doc.sliceString(from, to);
  const insert = "```\n" + selected + "\n```";
  return {
    changes: { from, to, insert },
    selection: { anchor: from + 4, head: from + 4 + selected.length },
  };
}

export function toggleCodeBlock(view: EditorView): boolean {
  if (!canRunFormatting(view)) return false;
  view.dispatch(view.state.update(buildToggleCodeBlockSpec(view.state)));
  return true;
}
