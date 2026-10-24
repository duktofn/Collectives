import { EditorView } from "@codemirror/view";
import { WikilinkFragment, WikilinkToken, NoteLinkCandidate } from "../../types";
import type { NoteLinkNavigationOutcome } from "../../features/links/noteLinkServices";

export interface WikilinkResolutionContext {
  collectionId: string;
  sourcePath: string | null;
  isCurrent: () => boolean;
  resolveCandidates: (collectionId: string, noteName: string, sourcePath?: string) => Promise<NoteLinkCandidate[]>;
}

export async function resolveAndNavigate(
  token: WikilinkToken,
  context: WikilinkResolutionContext,
  callbacks: {
    onCandidates: (
      candidates: NoteLinkCandidate[],
      fragment: WikilinkFragment | null,
    ) => Promise<NoteLinkNavigationOutcome>;
    onNoMatch: (token: WikilinkToken) => void;
    onError?: (token: WikilinkToken, error: unknown) => void;
  },
): Promise<NoteLinkNavigationOutcome | "missing"> {
  try {
    const candidates = await context.resolveCandidates(context.collectionId, token.noteName, context.sourcePath ?? undefined);
    if (!context.isCurrent()) return "stale";
    if (candidates.length === 0) {
      callbacks.onNoMatch(token);
      return "missing";
    }
    return await callbacks.onCandidates(candidates, token.fragment);
  } catch (error) {
    if (!context.isCurrent()) return "stale";
    console.error("Failed to resolve wikilink:", error);
    callbacks.onError?.(token, error);
    return "failed";
  }
}

export function navigateToFragment(view: EditorView, fragment: WikilinkFragment): void {
  const doc = view.state.doc;
  const targetValue = fragment.value;

  if (fragment.type === "block") {
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      const text = line.text;
      const match = text.match(/\^([a-zA-Z0-9]+)$/);
      if (match && match[1] === targetValue) {
        const pos = line.from;
        view.dispatch({
          selection: { anchor: pos },
          scrollIntoView: true,
        });
        view.focus();
        return;
      }
    }
  } else if (fragment.type === "heading") {
    const headingRegex = /^(#{1,6})\s+(.+)$/;
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      const text = line.text;
      const match = text.match(headingRegex);
      if (match && match[2].trim() === targetValue) {
        const pos = line.from;
        view.dispatch({
          selection: { anchor: pos },
          scrollIntoView: true,
        });
        view.focus();
        return;
      }
    }
  }
}
