import { RangeSetBuilder, EditorState, Extension } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import { parseWikilink } from "../wikilink/parser";
import { resolveAndNavigate } from "../wikilink/resolver";
import { collectionsStore } from "../../stores/collections";
import { editorStore } from "../../stores/editor";
import { resolveWikilink } from "../tauri";
import { message } from "@tauri-apps/plugin-dialog";
import { EmptyWidget } from "./empty-widget";

interface DecSpec {
  from: number;
  to: number;
  value: Decoration;
}

export const wikilinkCache = new Map<string, boolean>();
const MAX_CACHE_SIZE = 1000;

function setCacheValue(key: string, value: boolean) {
  if (wikilinkCache.size >= MAX_CACHE_SIZE && !wikilinkCache.has(key)) {
    const oldestKey = wikilinkCache.keys().next().value;
    if (oldestKey !== undefined) {
      wikilinkCache.delete(oldestKey);
    }
  }
  wikilinkCache.set(key, value);
}

export function clearWikilinkCache() {
  wikilinkCache.clear();
}

class WikilinkDecorationPlugin {
  decorations: DecorationSet;
  atomic: DecorationSet;

  constructor(view: EditorView) {
    const { decorations, atomic } = this.buildDecorations(view);
    this.decorations = decorations;
    this.atomic = atomic;
  }

  update(update: ViewUpdate) {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      update.transactions.some(tr => tr.reconfigured)
    ) {
      const { decorations, atomic } = this.buildDecorations(update.view);
      this.decorations = decorations;
      this.atomic = atomic;
    }
  }

  buildDecorations(view: EditorView): { decorations: DecorationSet; atomic: DecorationSet } {
    const decs: DecSpec[] = [];
    const doc = view.state.doc;
    const selection = view.state.selection.main;
    const collectionId = collectionsStore.state.activeCollectionId;

    if (!collectionId) {
      return { decorations: Decoration.none, atomic: Decoration.none };
    }

    for (const { from, to } of view.visibleRanges) {
      const text = doc.sliceString(from, to);
      const regex = /\[\[([^\]]+)\]\]/g;
      let match;

      while ((match = regex.exec(text)) !== null) {
        const matchIndex = match.index;
        const matchStart = from + matchIndex;
        const matchEnd = matchStart + match[0].length;

        const rawText = match[0];
        const parsed = parseWikilink(rawText);
        if (!parsed) continue;

        const startLine = doc.lineAt(matchStart);
        const endLine = doc.lineAt(matchEnd);
        const isCursorInLine = selection.head >= startLine.from && selection.head <= endLine.to;

        const cacheKey = `${collectionId}:${parsed.noteName}`;
        if (!wikilinkCache.has(cacheKey)) {
          setCacheValue(cacheKey, true);
          resolveWikilink(collectionId, parsed.noteName)
            .then((candidate) => {
              const exists = candidate !== null;
              if (wikilinkCache.get(cacheKey) !== exists) {
                setCacheValue(cacheKey, exists);
                if (view.dom.isConnected) {
                  view.dispatch({});
                }
              }
            })
            .catch(() => {
              setCacheValue(cacheKey, false);
              if (view.dom.isConnected) {
                view.dispatch({});
              }
            });
        }

        const isValid = wikilinkCache.get(cacheKey) ?? true;
        const linkClass = isValid ? "cm-wikilink" : "cm-wikilink cm-wikilink-broken";

        const hashIndex = rawText.indexOf("#");
        const noteNameEnd = hashIndex !== -1 ? matchStart + hashIndex : matchEnd - 2;

        if (!isCursorInLine) {
          // Hide [[
          decs.push({
            from: matchStart,
            to: matchStart + 2,
            value: Decoration.replace({ widget: new EmptyWidget() }),
          });

          // Hide ]]
          decs.push({
            from: matchEnd - 2,
            to: matchEnd,
            value: Decoration.replace({ widget: new EmptyWidget() }),
          });

          // Hide fragment if present
          if (parsed.fragment && hashIndex !== -1) {
            decs.push({
              from: noteNameEnd,
              to: matchEnd - 2,
              value: Decoration.replace({ widget: new EmptyWidget() }),
            });
          }
        }

        // Highlight only the note name part to prevent overlap with fragment replacement decoration
        if (matchStart + 2 < noteNameEnd) {
          decs.push({
            from: matchStart + 2,
            to: noteNameEnd,
            value: Decoration.mark({ class: linkClass }),
          });
        }
      }
    }

    // Sort decorations: by 'from' ascending, then by 'startSide' ascending, then by 'to' descending
    decs.sort((a, b) => {
      if (a.from !== b.from) return a.from - b.from;
      if (a.value.startSide !== b.value.startSide) {
        return a.value.startSide - b.value.startSide;
      }
      return b.to - a.to;
    });

    const builder = new RangeSetBuilder<Decoration>();
    const atomicBuilder = new RangeSetBuilder<Decoration>();
    let lastFrom = -1;
    let lastTo = -1;

    for (const dec of decs) {
      if (dec.from >= lastFrom) {
        const isReplacement = dec.value.spec.widget !== undefined;
        if (isReplacement && dec.from < lastTo) {
          // Skip overlapping replacements
          continue;
        }

        builder.add(dec.from, dec.to, dec.value);
        if (isReplacement) {
          atomicBuilder.add(dec.from, dec.to, dec.value);
          lastTo = dec.to;
        }
        lastFrom = dec.from;
      }
    }
    return {
      decorations: builder.finish(),
      atomic: atomicBuilder.finish(),
    };
  }
}

const wikilinkClickEffect = EditorView.domEventHandlers({
  click(event, view) {
    const target = event.target as HTMLElement;
    if (!target.classList.contains("cm-wikilink")) return false;

    const isEditable = !view.state.facet(EditorState.readOnly);
    if (isEditable && !event.ctrlKey && !event.metaKey) {
      return false;
    }

    const pos = view.posAtDOM(target);
    const docText = view.state.doc.toString();

    let startPos = -1;
    let endPos = -1;

    for (let i = pos; i >= 0; i--) {
      if (docText.startsWith("[[", i)) {
        startPos = i;
        break;
      }
      if (docText[i] === "\n" || (i < pos && docText.startsWith("]]", i))) {
        break;
      }
    }

    if (startPos !== -1) {
      const closing = docText.indexOf("]]", startPos);
      if (closing !== -1 && closing >= pos - 2) {
        endPos = closing + 2;
      }
    }

    if (startPos !== -1 && endPos !== -1) {
      const raw = docText.slice(startPos, endPos);
      const parsed = parseWikilink(raw);
      const collectionId = collectionsStore.state.activeCollectionId;

      if (parsed && collectionId) {
        resolveAndNavigate(parsed, collectionId, {
          onMatch: async (candidate, fragment) => {
            if (editorStore.state.openFilePath !== candidate.path) {
              await editorStore.openFile(candidate.path);
            }
            if (fragment) {
              editorStore.navigateTo(fragment);
            }
          },
          onNoMatch: async (token) => {
            await message(`Note "${token.noteName}" not found in this collection.`, {
              title: "Note Not Found",
              kind: "error",
            });
          },
        });
        return true;
      }
    }

    return false;
  },
});

const wikilinkDecPlugin = ViewPlugin.fromClass(WikilinkDecorationPlugin, {
  decorations: (v) => v.decorations,
});

export const wikilinkDecorationExtension: Extension = [
  wikilinkDecPlugin,
  wikilinkClickEffect,
  EditorView.atomicRanges.of((view) => {
    const plugin = view.plugin(wikilinkDecPlugin);
    return plugin ? plugin.atomic : Decoration.none;
  }),
];
