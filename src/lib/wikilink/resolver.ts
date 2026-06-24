import { EditorView } from "@codemirror/view";
import { WikilinkToken, WikilinkFragment, ResolveCandidate } from "../../types";
import { resolveWikilink } from "../tauri";

export async function resolveAndNavigate(
  token: WikilinkToken,
  collectionId: string,
  callbacks: {
    onMatch: (candidate: ResolveCandidate, fragment: WikilinkFragment | null) => void;
    onNoMatch: (token: WikilinkToken) => void;
  }
): Promise<void> {
  try {
    const candidate = await resolveWikilink(collectionId, token.noteName);
    if (candidate) {
      callbacks.onMatch(candidate, token.fragment);
    } else {
      callbacks.onNoMatch(token);
    }
  } catch (error) {
    console.error("Failed to resolve wikilink:", error);
    callbacks.onNoMatch(token);
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
