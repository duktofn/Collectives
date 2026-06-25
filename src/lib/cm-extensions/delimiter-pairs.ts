import { Prec, Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

const OPEN_TO_CLOSE: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "`": "`",
  '"': '"',
  "'": "'",
};

const CLOSE_CHARS = new Set(Object.values(OPEN_TO_CLOSE));

function getMatchingClose(open: string): string | null {
  return OPEN_TO_CLOSE[open] ?? null;
}

function getMatchingOpen(close: string): string | null {
  for (const [open, mappedClose] of Object.entries(OPEN_TO_CLOSE)) {
    if (mappedClose === close) return open;
  }
  return null;
}

function shouldSkipPairInsert(view: EditorView, from: number, open: string): boolean {
  if (open !== "[") return false;
  return from > 0 && view.state.doc.sliceString(from - 1, from) === "[";
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

function insertPair(
  view: EditorView,
  from: number,
  to: number,
  open: string,
  close: string
): boolean {
  if (from !== to) {
    const selected = view.state.doc.sliceString(from, to);
    view.dispatch({
      changes: { from, to, insert: open + selected + close },
      selection: { anchor: from + open.length + selected.length },
    });
    return true;
  }

  view.dispatch({
    changes: { from, to, insert: open + close },
    selection: { anchor: from + open.length },
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
  if (text.length !== 1) return false;

  const char = text;

  if (handleOvertypeClose(view, from, to, char)) {
    return true;
  }

  const close = getMatchingClose(char);
  if (!close) return false;

  if (shouldSkipPairInsert(view, from, char)) {
    view.dispatch({
      changes: { from, to, insert: char },
      selection: { anchor: from + 1 },
    });
    return true;
  }

  return insertPair(view, from, to, char, close);
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
  EditorView.inputHandler.of((view, from, to, text) =>
    handleDelimiterInput(view, from, to, text)
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
