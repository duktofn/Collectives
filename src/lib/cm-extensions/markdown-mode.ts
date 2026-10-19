import { Compartment, Extension, EditorState, Transaction } from "@codemirror/state";
import { autocompletion } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { Strikethrough } from "@lezer/markdown";
import { tableMarkdownExtension } from "./table-markdown-extension";
import { codeLanguages } from './code-languages';
import { indentOnInput } from "@codemirror/language";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, standardKeymap } from "@codemirror/commands";
import { renderDecorationsExtension } from "./render-decorations";
import { inlineFormattingExitExtension } from './inline-formatting';
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
import { editorLayoutExtension } from './editor-layout';
import { codeSyntaxHighlighting, sourceCodeExtensions } from './code-presentation';
import { wordOccurrenceHighlighting } from './word-occurrences';
import { searchKeymap } from '@codemirror/search';

// Slash/WikiLink completion is explicitly requested by typing its marker.
// Accept Enter as soon as its result is visible, including fast command input.
const sourceMarkdownAutocomplete = autocompletion({ override: [slashTemplateCompletionSource], activateOnTyping: true, interactionDelay: 0 });
const renderMarkdownAutocomplete = autocompletion({ override: [wikilinkCompletionSource, slashTemplateCompletionSource], activateOnTyping: true, interactionDelay: 0 });

export const baseEditorExtensions: Extension[] = [
  EditorState.transactionFilter.of((transaction) =>
    transaction.startState.readOnly && transaction.docChanged && transaction.annotation(Transaction.userEvent)
      ? [] : transaction),
  wordOccurrenceHighlighting('markdown'),
  editorLayoutExtension,
  markdown({ codeLanguages, extensions: [tableMarkdownExtension, Strikethrough] }),
  codeSyntaxHighlighting,
  history(),
  drawSelection(),
  indentOnInput(),
  delimiterPairExtension,
  formattingKeymapExtension,
  keymap.of([...defaultKeymap, ...standardKeymap, ...historyKeymap, ...searchKeymap]),
];

export const textSourceEditorExtensions: Extension[] = [
  wordOccurrenceHighlighting('code'),
  editorLayoutExtension,
  codeSyntaxHighlighting,
  history(),
  drawSelection(),
  indentOnInput(),
  keymap.of([...defaultKeymap, ...standardKeymap, ...historyKeymap, ...searchKeymap]),
];

export function getBaseExtensionsForFile(kind: FileKind | null, path = ''): Extension[] {
  return kind === "text-source" ? [textSourceEditorExtensions, sourceCodeExtensions(path)] : baseEditorExtensions;
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
        EditorView.lineWrapping,
        EditorView.editable.of(true),
        EditorState.readOnly.of(false),
        renderDecorationsExtension,
        inlineFormattingExitExtension,
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
        EditorView.lineWrapping,
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



