import { Compartment, Extension, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { renderDecorationsExtension } from "./render-decorations";
import { tableWidgetExtension } from "./table-widget";
import { chartWidgetExtension } from "./chart-widget";
import { annotationExtension } from "./annotation";
import { wikilinkDecorationExtension } from "./wikilink-decoration";
import { wikilinkAutocomplete } from "./wikilink-autocomplete";
import { blockRefExtension } from "./block-ref";
import { editorModeFacet } from "./facet";

export const modeCompartment = new Compartment();

export function getExtensionsForMode(mode: "view" | "edit-source" | "edit-render"): Extension[] {
  const baseExtensions = [
    markdown({ codeLanguages: languages }),
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    keymap.of([...defaultKeymap, ...historyKeymap]),
    editorModeFacet.of(mode),
  ];

  switch (mode) {
    case "edit-source":
      return [
        ...baseExtensions,
        EditorView.editable.of(true),
        EditorState.readOnly.of(false),
      ];
    case "edit-render":
      return [
        ...baseExtensions,
        EditorView.editable.of(true),
        EditorState.readOnly.of(false),
        renderDecorationsExtension,
        tableWidgetExtension,
        chartWidgetExtension,
        annotationExtension,
        wikilinkDecorationExtension,
        wikilinkAutocomplete,
        blockRefExtension,
      ];
    case "view":
      return [
        ...baseExtensions,
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        renderDecorationsExtension,
        tableWidgetExtension,
        chartWidgetExtension,
        annotationExtension,
        wikilinkDecorationExtension,
        blockRefExtension,
      ];
  }
}



