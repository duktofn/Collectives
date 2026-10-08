import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { EditorView } from "@codemirror/view";
import { resolveWikilink } from "../../features/links";
import * as editorApi from "../../features/editor";
import { collectionsStore } from "../../stores/collections";
import type { WikilinkToken } from "../../types";
import { parseWikilink } from "../wikilink/parser";

interface PreviewCacheItem {
  displayName: string;
  path: string;
  preview: string;
  cachedAt: number;
}

const previewCache = new Map<string, PreviewCacheItem>();
let previewRequest = 0;
let previewTimer: ReturnType<typeof setTimeout> | undefined;

export function clearWikilinkPreviewCache(): void {
  previewCache.clear();
  previewRequest += 1;
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = undefined;
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

async function showPreview(token: WikilinkToken, position: { x: number; y: number }): Promise<void> {
  const collectionId = collectionsStore.state.activeCollectionId;
  if (!collectionId) return;
  const request = ++previewRequest;
  try {
    const candidate = await resolveWikilink(collectionId, token.noteName);
    if (request !== previewRequest) return;
    if (!candidate) {
      emitPreview({ noteName: token.noteName, missing: true, ...position });
      return;
    }
    const cacheKey = `${collectionId}:${candidate.path.toLowerCase()}`;
    const cached = previewCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < 30_000) {
      emitPreview({ ...cached, noteName: token.noteName, missing: false, ...position });
      return;
    }
    const raw = await editorApi.readFile(candidate.path);
    if (request !== previewRequest) return;
    const content = typeof raw === "string" ? raw : raw.content;
    const preview = content.split(/\r?\n/).slice(0, 8).join("\n").slice(0, 700);
    const item = { displayName: candidate.displayName, path: candidate.path, preview, cachedAt: Date.now() };
    previewCache.delete(cacheKey);
    previewCache.set(cacheKey, item);
    while (previewCache.size > 100) {
      const oldest = previewCache.keys().next().value;
      if (oldest === undefined) break;
      previewCache.delete(oldest);
    }
    emitPreview({ ...item, noteName: token.noteName, missing: false, ...position });
  } catch (error) {
    if (request !== previewRequest) return;
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
    previewTimer = setTimeout(() => {
      void showPreview(result.token, { x: rect.left, y: rect.bottom + 6 });
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
    void showPreview(result.token, { x: coords?.left ?? 12, y: coords?.bottom ?? 44 });
    return true;
  },
});

