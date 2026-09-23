import { Compartment, Extension, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { indentOnInput } from "@codemirror/language";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, standardKeymap } from "@codemirror/commands";
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
import type { FileKind } from "../../shared/fileCapabilities.generated";

export const baseEditorExtensions: Extension[] = [
  markdown({ codeLanguages: languages }),
  history(),
  drawSelection(),
  indentOnInput(),
  EditorView.lineWrapping,
  delimiterPairExtension,
  formattingKeymapExtension,
  keymap.of([...defaultKeymap, ...standardKeymap, ...historyKeymap]),
];

export const textSourceEditorExtensions: Extension[] = [
  history(),
  drawSelection(),
  indentOnInput(),
  EditorView.lineWrapping,
  keymap.of([...defaultKeymap, ...standardKeymap, ...historyKeymap]),
];

export function getBaseExtensionsForFile(kind: FileKind | null): Extension[] {
  return kind === "text-source" ? textSourceEditorExtensions : baseEditorExtensions;
}

export const modeCompartment = new Compartment();

export function getExtensionsForMode(mode: "view" | "edit-source" | "edit-render", kind: FileKind | null = "markdown"): Extension[] {
  if (kind === "text-source") return [
    editorModeFacet.of("edit-source"),
    EditorView.editable.of(mode !== "view"),
    EditorState.readOnly.of(mode === "view"),
  ];
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



