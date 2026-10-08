import { Prec, Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

const OPEN_TO_CLOSE: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "*": "*",
  "`": "`",
  '"': '"',
  "'": "'",
};

const CLOSE_CHARS = new Set(Object.values(OPEN_TO_CLOSE));

export interface DelimiterEdit {
  from: number;
  to: number;
  insert: string;
  cursor: number;
  overtype?: boolean;
}

function isEscaped(text: string, from: number): boolean {
  let slashes = 0;
  for (let index = from - 1; index >= 0 && text[index] === "\\"; index--) slashes++;
  return slashes % 2 === 1;
}

function hasUnclosedStrongDelimiter(text: string, to: number): boolean {
  let open = false;
  const lineStart = text.lastIndexOf("\n", to - 1) + 1;
  for (let index = lineStart; index < to;) {
    if (text[index] !== "*" || isEscaped(text, index)) {
      index++;
      continue;
    }
    let end = index + 1;
    while (end < to && text[end] === "*" && !isEscaped(text, end)) end++;
    if (Math.floor((end - index) / 2) % 2 === 1) open = !open;
    index = end;
  }
  return open;
}

/** Pure pairing rules shared by the document editor and Markdown table cells. */
export function getDelimiterEdit(text: string, from: number, to: number, input: string): DelimiterEdit | null {
  if (input.length !== 1 || from < 0 || to < from || to > text.length) return null;
  const char = input;
  if (char === "*" && from === to && text[from - 1] === "*" && text[from] === "*"
    && !hasUnclosedStrongDelimiter(text, from - 1)
    && !isEscaped(text, from - 1) && !isEscaped(text, from)) {
    // Turn the empty italic pair *|* into the empty bold pair **|**.
    return { from, to: from + 1, insert: "***", cursor: from + 1 };
  }
  if (from === to && CLOSE_CHARS.has(char) && text[from] === char) {
    return { from, to, insert: "", cursor: from + 1, overtype: true };
  }
  if (isEscaped(text, from)) return null;

  const close = OPEN_TO_CLOSE[char];
  if (!close) return null;
  if (char === "'" && /[\p{L}\p{N}_]/u.test(text[from - 1] ?? "")) return null;

  if (char === "[" && from > 0 && text[from - 1] === "[") {
    return { from, to, insert: char, cursor: from + 1 };
  }
  const selected = text.slice(from, to);
  return {
    from,
    to,
    insert: char + selected + close,
    cursor: from + char.length + selected.length,
  };
}

function getMatchingClose(open: string): string | null {
  return OPEN_TO_CLOSE[open] ?? null;
}

function getMatchingOpen(close: string): string | null {
  for (const [open, mappedClose] of Object.entries(OPEN_TO_CLOSE)) {
    if (mappedClose === close) return open;
  }
  return null;
}

function handleOvertypeClose(view: EditorView, from: number, to: number, char: string): boolean {
  if (from !== to) return false;
  if (!CLOSE_CHARS.has(char)) return false;
  if (from >= view.state.doc.length) return false;
  if (view.state.doc.sliceString(from, from + 1) !== char) return false;

  view.dispatch({
    selection: { anchor: from + 1 },
  });
  return true;
}

function handleDelimiterInput(
  view: EditorView,
  from: number,
  to: number,
  text: string
): boolean {
  if (view.state.readOnly) return false;
  const edit = getDelimiterEdit(view.state.doc.toString(), from, to, text);
  if (!edit) return false;
  view.dispatch({
    ...(edit.insert ? { changes: { from: edit.from, to: edit.to, insert: edit.insert } } : {}),
    selection: { anchor: edit.cursor },
  });
  return true;
}

function asymmetricBackspace(view: EditorView): boolean {
  if (!view.state.selection.main.empty) return false;

  const pos = view.state.selection.main.head;
  if (pos === 0) return false;

  const charBefore = view.state.doc.sliceString(pos - 1, pos);
  const charAfter = pos < view.state.doc.length ? view.state.doc.sliceString(pos, pos + 1) : "";
  const expectedClose = getMatchingClose(charBefore);

  if (!expectedClose || charAfter !== expectedClose) return false;

  view.dispatch({
    changes: { from: pos - 1, to: pos, insert: "" },
    selection: { anchor: pos - 1 },
  });
  return true;
}

function asymmetricForwardDelete(view: EditorView): boolean {
  if (!view.state.selection.main.empty) return false;

  const pos = view.state.selection.main.head;
  if (pos >= view.state.doc.length) return false;

  const charAfter = view.state.doc.sliceString(pos, pos + 1);
  const charBefore = pos > 0 ? view.state.doc.sliceString(pos - 1, pos) : "";
  const expectedOpen = getMatchingOpen(charAfter);

  if (!expectedOpen || charBefore !== expectedOpen) return false;

  view.dispatch({
    changes: { from: pos, to: pos + 1, insert: "" },
    selection: { anchor: pos },
  });
  return true;
}

export const delimiterPairExtension: Extension = [
  EditorView.domEventHandlers({
    paste(_event, view) {
      pastedViews.add(view);
      queueMicrotask(() => pastedViews.delete(view));
      return false;
    },
    drop(_event, view) {
      pastedViews.add(view);
      queueMicrotask(() => pastedViews.delete(view));
      return false;
    },
    compositionstart(_event, view) {
      composingViews.add(view);
      return false;
    },
    compositionend(_event, view) {
      setTimeout(() => composingViews.delete(view), 0);
      return false;
    },
  }),
  EditorView.inputHandler.of((view, from, to, text) =>
    !pastedViews.has(view) && !composingViews.has(view) && !view.composing
      ? handleDelimiterInput(view, from, to, text)
      : false
  ),
  Prec.high(
    keymap.of([
      {
        key: "Backspace",
        run: asymmetricBackspace,
      },
      {
        key: "Delete",
        run: asymmetricForwardDelete,
      },
    ])
  ),
];

export {
  OPEN_TO_CLOSE,
  asymmetricBackspace,
  asymmetricForwardDelete,
  handleDelimiterInput,
  handleOvertypeClose,
};

const pastedViews = new WeakSet<EditorView>();
const composingViews = new WeakSet<EditorView>();
