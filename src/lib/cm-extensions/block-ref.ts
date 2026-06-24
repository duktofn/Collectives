import { RangeSetBuilder, Extension } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  KeyBinding,
  keymap,
} from "@codemirror/view";
import { editorStore } from "../../stores/editor";
import { EmptyWidget } from "./empty-widget";

interface DecSpec {
  from: number;
  to: number;
  value: Decoration;
}

export function generateBlockId(existingIds: Set<string>): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  do {
    id = "";
    for (let i = 0; i < 6; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (existingIds.has(id));
  return id;
}

class BlockRefPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.buildDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = this.buildDecorations(update.view);
    }
  }

  buildDecorations(view: EditorView): DecorationSet {
    const decs: DecSpec[] = [];
    const doc = view.state.doc;
    const selection = view.state.selection.main;

    for (const { from, to } of view.visibleRanges) {
      let pos = from;
      while (pos < to) {
        const line = doc.lineAt(pos);
        const text = line.text;

        const match = text.match(/ (\^[a-zA-Z0-9]+)$/);
        if (match) {
          const matchLen = match[0].length;
          const start = line.from + text.length - matchLen;
          const end = line.to;

          if (start >= from && end <= to) {
            const isCursorInLine = selection.head >= line.from && selection.head <= line.to;

            if (isCursorInLine) {
              decs.push({
                from: start,
                to: end,
                value: Decoration.mark({ class: "cm-block-ref-visible" }),
              });
            } else {
              decs.push({
                from: start,
                to: end,
                value: Decoration.replace({ widget: new EmptyWidget() }),
              });
            }
          }
        }
        pos = line.to + 1;
      }
    }

    decs.sort((a, b) => a.from - b.from);

    const builder = new RangeSetBuilder<Decoration>();
    for (const d of decs) {
      builder.add(d.from, d.to, d.value);
    }
    return builder.finish();
  }
}

export function copyBlockLink(view: EditorView): boolean {
  const currentFileName = editorStore.currentFileName;
  if (!currentFileName) return false;

  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.head);
  const text = line.text;

  let blockId = "";
  const match = text.match(/ \^([a-zA-Z0-9]+)$/);

  if (match) {
    blockId = match[1];
  } else {
    const existingIds = new Set<string>();
    const docText = view.state.doc.toString();
    const allMatches = docText.matchAll(/ \^([a-zA-Z0-9]+)/g);
    for (const m of allMatches) {
      existingIds.add(m[1]);
    }

    blockId = generateBlockId(existingIds);

    const insertPos = line.to;
    view.dispatch({
      changes: {
        from: insertPos,
        to: insertPos,
        insert: ` ^${blockId}`,
      },
    });
  }

  const wikilink = `[[${currentFileName}#^${blockId}]]`;
  navigator.clipboard
    .writeText(wikilink)
    .catch((err) => {
      console.error("Failed to copy block link to clipboard:", err);
    });

  return true;
}

export const blockRefKeymap: KeyBinding[] = [
  {
    key: "Mod-Shift-l",
    run: (view) => {
      return copyBlockLink(view);
    },
  },
];

export const blockRefExtension: Extension = [
  ViewPlugin.fromClass(BlockRefPlugin, {
    decorations: (v) => v.decorations,
  }),
  keymap.of(blockRefKeymap),
];
