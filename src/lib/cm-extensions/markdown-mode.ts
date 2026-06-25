import { Compartment, Extension, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { renderDecorationsExtension } from "./render-decorations";
import { codeBlockWidgetExtension } from "./code-block-widget";
import { tableWidgetExtension } from "./table-widget";
import { chartWidgetExtension } from "./chart-widget";
import { annotationExtension } from "./annotation";
import { wikilinkDecorationExtension } from "./wikilink-decoration";
import { wikilinkAutocomplete } from "./wikilink-autocomplete";
import { blockRefExtension, blockRefDecorationExtension } from "./block-ref";
import { editorModeFacet } from "./facet";
import { delimiterPairExtension } from "./delimiter-pairs";
import { formattingKeymapExtension } from "./formatting-keymap";

export const baseEditorExtensions: Extension[] = [
  markdown({ codeLanguages: languages }),
  history(),
  drawSelection(),
  EditorView.lineWrapping,
  delimiterPairExtension,
  formattingKeymapExtension,
  keymap.of([...defaultKeymap, ...historyKeymap]),
];

export const modeCompartment = new Compartment();

export function getExtensionsForMode(mode: "view" | "edit-source" | "edit-render"): Extension[] {
  switch (mode) {
    case "edit-source":
      return [
        editorModeFacet.of(mode),
        EditorView.editable.of(true),
        EditorState.readOnly.of(false),
      ];
    case "edit-render":
      return [
        editorModeFacet.of(mode),
        EditorView.editable.of(true),
        EditorState.readOnly.of(false),
        renderDecorationsExtension,
        codeBlockWidgetExtension,
        tableWidgetExtension,
        chartWidgetExtension,
        annotationExtension,
        wikilinkDecorationExtension,
        wikilinkAutocomplete,
        blockRefExtension,
      ];
    case "view":
      return [
        editorModeFacet.of(mode),
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        renderDecorationsExtension,
        codeBlockWidgetExtension,
        tableWidgetExtension,
        chartWidgetExtension,
        annotationExtension,
        wikilinkDecorationExtension,
        blockRefDecorationExtension,
      ];
  }
}



