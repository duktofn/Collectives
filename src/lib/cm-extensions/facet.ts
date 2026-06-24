import { Facet } from "@codemirror/state";
import { EditorMode } from "../../types";

export const editorModeFacet = Facet.define<EditorMode, EditorMode>({
  combine: (values) => values[0] || "edit-render",
});
