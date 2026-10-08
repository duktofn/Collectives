import { Compartment, Extension, EditorState } from "@codemirror/state";
import { autocompletion } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { tableMarkdownExtension } from "./table-markdown-extension";
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
import { wikilinkCompletionSource } from "./wikilink-autocomplete";
import { blockRefExtension, blockRefDecorationExtension } from "./block-ref";
import { editorModeFacet } from "./facet";
import { delimiterPairExtension } from "./delimiter-pairs";
import { formattingKeymapExtension } from "./formatting-keymap";
import { slashTemplateCompletionSource } from "./slash-template-autocomplete";
import type { FileKind } from "../../shared/fileCapabilities.generated";

const sourceMarkdownAutocomplete = autocompletion({ override: [slashTemplateCompletionSource], activateOnTyping: true });
const renderMarkdownAutocomplete = autocompletion({ override: [wikilinkCompletionSource, slashTemplateCompletionSource], activateOnTyping: true });

export const baseEditorExtensions: Extension[] = [
  markdown({ codeLanguages: languages, extensions: [tableMarkdownExtension] }),
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
        sourceMarkdownAutocomplete,
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
        renderMarkdownAutocomplete,
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



