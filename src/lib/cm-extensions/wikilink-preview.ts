import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { EditorView } from "@codemirror/view";
import { noteLinkContextFacet } from "../../features/links/noteLinkContext";
import type { WikilinkToken } from "../../types";
import { parseWikilink } from "../wikilink/parser";
import type { NoteLinkPreviewCacheItem } from "../../features/links/noteLinkServices";

let previewRequest = 0;
let previewTimer: ReturnType<typeof setTimeout> | undefined;

export function clearWikilinkPreviewCache(): void {
  hidePreview();
}

function tokenAtPosition(view: EditorView, position: number): { token: WikilinkToken; from: number } | null {
  const line = view.state.doc.lineAt(position);
  const regex = /\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line.text))) {
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (position < from || position > to) continue;
    let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(from, -1);
    let insideCode = false;
    while (node) {
      if (["FencedCode", "IndentedCode", "InlineCode"].includes(node.name)) insideCode = true;
      node = node.parent;
    }
    if (insideCode) return null;
    const token = parseWikilink(match[0]);
    if (token) return { token, from };
  }
  return null;
}

function emitPreview(detail: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent("collectives:wikilink-preview", { detail }));
}

function hidePreview(): void {
  previewRequest += 1;
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = undefined;
  window.dispatchEvent(new CustomEvent("collectives:wikilink-preview-hide"));
}

async function showPreview(
  token: WikilinkToken,
  position: { x: number; y: number },
  view: EditorView,
  request: number,
): Promise<void> {
  const context = view.state.facet(noteLinkContextFacet);
  const collectionId = context?.collectionId() ?? null;
  if (!collectionId || !context || context.isDisposed()) return;
  const sourcePath = context.sourcePath();
  const sessionKey = context.sessionKey();
  const cacheEpoch = context.cache.epoch();
  const isCurrent = () => request === previewRequest
    && view.dom.isConnected
    && !context.isDisposed()
    && context.collectionId() === collectionId
    && context.sourcePath() === sourcePath
    && context.sessionKey() === sessionKey
    && context.cache.epoch() === cacheEpoch;
  try {
    const candidates = await context.resolveCandidates(collectionId, token.noteName, sourcePath ?? undefined);
    if (!isCurrent()) return;
    if (candidates.length === 0) {
      emitPreview({ noteName: token.noteName, missing: true, ...position });
      return;
    }
    if (candidates.length > 1) {
      emitPreview({
        noteName: token.noteName,
        ambiguous: true,
        candidates: candidates.map(candidate => ({ displayName: candidate.displayName, path: candidate.path })),
        ...position,
      });
      return;
    }
    const candidate = candidates[0];
    const cacheKey = JSON.stringify([collectionId, candidate.folderRefRootPath ?? null, candidate.path]);
    const cached = context.cache.getPreview(cacheKey);
    if (cached) {
      emitPreview({ ...cached, noteName: token.noteName, missing: false, ...position });
      return;
    }
    const content = await context.readCandidateContent(candidate);
    if (!isCurrent()) return;
    const preview = content.split(/\r?\n/).slice(0, 8).join("\n").slice(0, 700);
    const item: NoteLinkPreviewCacheItem = { displayName: candidate.displayName, path: candidate.path, preview, cachedAt: Date.now() };
    context.cache.setPreview(cacheKey, item);
    emitPreview({ ...item, noteName: token.noteName, missing: false, ...position });
  } catch (error) {
    if (!isCurrent()) return;
    emitPreview({ noteName: token.noteName, error: String(error), missing: false, ...position });
  }
}

export const wikilinkPreviewHandlers = EditorView.domEventHandlers({
  mouseover(event, view) {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".cm-wikilink") : null;
    if (!target) return false;
    const position = view.posAtDOM(target);
    const result = tokenAtPosition(view, position);
    if (!result) return false;
    hidePreview();
    const rect = target.getBoundingClientRect();
    const request = previewRequest;
    previewTimer = setTimeout(() => {
      void showPreview(result.token, { x: rect.left, y: rect.bottom + 6 }, view, request);
    }, 260);
    return false;
  },
  mouseout(event) {
    const next = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
    if (next?.closest(".cm-wikilink-preview, .cm-wikilink")) return false;
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(hidePreview, 120);
    return false;
  },
  keydown(event, view) {
    if (event.key === "Escape") {
      hidePreview();
      return false;
    }
    if (event.key !== "F1") return false;
    const result = tokenAtPosition(view, view.state.selection.main.head);
    if (!result) return false;
    event.preventDefault();
    const coords = view.coordsAtPos(result.from);
    const request = ++previewRequest;
    void showPreview(result.token, { x: coords?.left ?? 12, y: coords?.bottom ?? 44 }, view, request);
    return true;
  },
});

