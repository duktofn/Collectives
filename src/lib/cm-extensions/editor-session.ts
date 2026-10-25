import { Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export const editorSessionKeyFacet = Facet.define<string, string>({
  combine: (sessionKeys) => sessionKeys[0] ?? "",
});

export function isEditorSessionCurrent(view: EditorView, expectedSessionKey: string): boolean {
  return view.state.facet(editorSessionKeyFacet) === expectedSessionKey;
}
