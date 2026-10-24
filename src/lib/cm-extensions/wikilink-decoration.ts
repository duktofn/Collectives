import { RangeSetBuilder, EditorState, Extension, StateEffect } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { parseWikilink } from '../wikilink/parser';
import { resolveAndNavigate } from '../wikilink/resolver';
import { noteLinkContextFacet } from '../../features/links/noteLinkContext';
import { noteLinkStatusCacheKey } from '../../features/links/noteLinkServices';
import type { NoteLinkContext } from '../../features/links/noteLinkServices';
import { EmptyWidget } from './empty-widget';
import { clearWikilinkPreviewCache, wikilinkPreviewHandlers } from './wikilink-preview';

interface DecSpec {
  from: number;
  to: number;
  value: Decoration;
}

const refreshWikilinkDecorations = StateEffect.define<null>();

function contextIsCurrent(
  context: NoteLinkContext,
  collectionId: string,
  sourcePath: string | null,
  sessionKey: string,
  cacheEpoch: number,
): boolean {
  return !context.isDisposed()
    && context.collectionId() === collectionId
    && context.sourcePath() === sourcePath
    && context.sessionKey() === sessionKey
    && context.cache.epoch() === cacheEpoch;
}

class WikilinkDecorationPlugin {
  decorations: DecorationSet;
  atomic: DecorationSet;
  private navigationGeneration = 0;
  private disposed = false;
  private unsubscribeCache: () => void;

  constructor(view: EditorView) {
    const context = view.state.facet(noteLinkContextFacet);
    this.unsubscribeCache = context?.cache.subscribeInvalidation(() => {
      if (!this.disposed && view.dom.isConnected) {
        clearWikilinkPreviewCache();
        view.dispatch({ effects: refreshWikilinkDecorations.of(null) });
      }
    }) ?? (() => {});
    const { decorations, atomic } = this.buildDecorations(view);
    this.decorations = decorations;
    this.atomic = atomic;
  }

  beginNavigation(): number {
    return ++this.navigationGeneration;
  }

  isCurrentNavigation(generation: number): boolean {
    return !this.disposed && generation === this.navigationGeneration;
  }

  destroy(): void {
    this.disposed = true;
    this.navigationGeneration += 1;
    this.unsubscribeCache();
  }

  update(update: ViewUpdate) {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.transactions.some((tr) => tr.reconfigured
        || tr.effects.some(effect => effect.is(refreshWikilinkDecorations)))
    ) {
      const { decorations, atomic } = this.buildDecorations(update.view);
      this.decorations = decorations;
      this.atomic = atomic;
    }
  }

  buildDecorations(view: EditorView): { decorations: DecorationSet; atomic: DecorationSet } {
    const decs: DecSpec[] = [];
    const atomicDecs: DecSpec[] = [];
    const doc = view.state.doc;
    const context = view.state.facet(noteLinkContextFacet);
    const collectionId = context?.collectionId() ?? null;

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

        const cacheKey = noteLinkStatusCacheKey(collectionId, parsed.noteName);
        const cached = context?.cache.get(cacheKey);
        if (cached === undefined && context && !context.isDisposed()) {
          context.cache.set(cacheKey, true);
          const sourcePath = context.sourcePath();
          const sessionKey = context.sessionKey();
          const cacheEpoch = context.cache.epoch();
          context.resolveCandidates(collectionId, parsed.noteName, sourcePath ?? undefined)
            .then((candidates) => {
              if (!view.dom.isConnected || !contextIsCurrent(context, collectionId, sourcePath, sessionKey, cacheEpoch)) return;
              context.cache.set(cacheKey, candidates.length > 0);
              view.dispatch({ effects: refreshWikilinkDecorations.of(null) });
            })
            .catch(() => {
              if (!view.dom.isConnected || !contextIsCurrent(context, collectionId, sourcePath, sessionKey, cacheEpoch)) return;
              context.cache.set(cacheKey, false);
              view.dispatch({ effects: refreshWikilinkDecorations.of(null) });
            });
        }

        const isValid = context?.cache.get(cacheKey) ?? true;
        const linkClass = isValid ? 'cm-wikilink' : 'cm-wikilink cm-wikilink-broken';

        const hashIndex = rawText.indexOf('#');
        const noteNameEnd = hashIndex !== -1 ? matchStart + hashIndex : matchEnd - 2;

        const valStart = Decoration.replace({ widget: new EmptyWidget() });
        const valEnd = Decoration.replace({ widget: new EmptyWidget() });
        const valFrag =
          parsed.fragment && hashIndex !== -1
            ? Decoration.replace({ widget: new EmptyWidget() })
            : null;

        // Hide [[
        decs.push({
          from: matchStart,
          to: matchStart + 2,
          value: valStart,
        });

        // Hide ]]
        decs.push({
          from: matchEnd - 2,
          to: matchEnd,
          value: valEnd,
        });

        // Hide fragment if present
        if (valFrag) {
          decs.push({
            from: noteNameEnd,
            to: matchEnd - 2,
            value: valFrag,
          });
        }

        atomicDecs.push({
          from: matchStart,
          to: matchStart + 2,
          value: valStart,
        });

        atomicDecs.push({
          from: matchEnd - 2,
          to: matchEnd,
          value: valEnd,
        });

        if (valFrag) {
          atomicDecs.push({
            from: noteNameEnd,
            to: matchEnd - 2,
            value: valFrag,
          });
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

    atomicDecs.sort((a, b) => {
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
          lastTo = dec.to;
        }
        lastFrom = dec.from;
      }
    }

    lastFrom = -1;
    lastTo = -1;
    for (const dec of atomicDecs) {
      if (dec.from >= lastFrom) {
        const isReplacement = dec.value.spec.widget !== undefined;
        if (isReplacement && dec.from < lastTo) {
          continue;
        }

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
    if (!target.classList.contains('cm-wikilink')) return false;

    const isEditable = !view.state.facet(EditorState.readOnly);
    if (isEditable && !event.ctrlKey && !event.metaKey) {
      return false;
    }

    const pos = view.posAtDOM(target);
    const line = view.state.doc.lineAt(pos);
    const lineText = line.text;
    const regex = /\[\[([^\]]+)\]\]/g;
    let match;
    let startPos = -1;
    let endPos = -1;

    while ((match = regex.exec(lineText)) !== null) {
      const matchStart = line.from + match.index;
      const matchEnd = matchStart + match[0].length;
      if (pos >= matchStart && pos <= matchEnd) {
        startPos = matchStart;
        endPos = matchEnd;
        break;
      }
    }

    if (startPos !== -1 && endPos !== -1) {
      const raw = view.state.doc.sliceString(startPos, endPos);
      const parsed = parseWikilink(raw);
      const context = view.state.facet(noteLinkContextFacet);
      const collectionId = context?.collectionId() ?? null;

      if (parsed && collectionId && context && !context.isDisposed()) {
        const plugin = view.plugin(wikilinkDecPlugin);
        const requestId = plugin?.beginNavigation() ?? 0;
        const sourcePath = context.sourcePath();
        const sourceEntryId = context.selectedEntryId();
        const sessionKey = context.sessionKey();
        const cacheEpoch = context.cache.epoch();
        const isCurrent = () => Boolean(plugin?.isCurrentNavigation(requestId))
          && view.dom.isConnected
          && context.selectedEntryId() === sourceEntryId
          && contextIsCurrent(context, collectionId, sourcePath, sessionKey, cacheEpoch);
        context.navigationStarted(requestId);
        void resolveAndNavigate(parsed, {
          collectionId,
          sourcePath,
          isCurrent,
          resolveCandidates: context.resolveCandidates,
        }, {
          onCandidates: (candidates, fragment) => context.requestNavigation({
            contextId: context.contextId,
            requestId,
            collectionId,
            sourcePath,
            sourceEntryId,
            sessionKey,
            noteName: parsed.noteName,
            candidates,
            fragment,
            isCurrent,
            restoreFocus: context.restoreFocus,
          }),
          onNoMatch: async (token) => {
            window.dispatchEvent(
              new CustomEvent('collectives:wikilink-missing', {
                detail: { noteName: token.noteName },
              })
            );
          },
          onError: (_token, error) => {
            window.dispatchEvent(
              new CustomEvent('collectives:wikilink-error', { detail: { message: String(error) } })
            );
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
  wikilinkPreviewHandlers,
  EditorView.atomicRanges.of((view) => {
    const plugin = view.plugin(wikilinkDecPlugin);
    return plugin ? plugin.atomic : Decoration.none;
  }),
];
