import { Prec, Extension } from "@codemirror/state";
import { EditorView, KeyBinding, keymap } from "@codemirror/view";
import { isCursorInFencedCode } from "./code-block-widget";
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

export const formattingKeymapExtension: Extension = [
  keymap.of(formattingBindings),
  Prec.high(keymap.of(listIndentKeymap)),
];
