import { Compartment, Extension, EditorState, Transaction } from "@codemirror/state";
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
import { annotationExtension } from "./annotation";
import { editorModeFacet } from "./facet";
import { delimiterPairExtension } from "./delimiter-pairs";
import { formattingKeymapExtension } from "./formatting-keymap";
import type { FileKind } from "../../shared/fileCapabilities.generated";
import { editorLayoutExtension } from './editor-layout';
import { codeSyntaxHighlighting, sourceCodeExtensions } from './code-presentation';
import { wordOccurrenceHighlighting } from './word-occurrences';
import { searchKeymap } from '@codemirror/search';
import {
  getBuiltinEditorCompletionExtension,
  getBuiltinEditorContributionExtensions,
} from "../../features/builtin/editorContributions";

const sourceMarkdownAutocomplete = getBuiltinEditorCompletionExtension("edit-source");
const renderMarkdownAutocomplete = getBuiltinEditorCompletionExtension("edit-render");

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
        ...(sourceMarkdownAutocomplete ? [sourceMarkdownAutocomplete] : []),
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
        ...getBuiltinEditorContributionExtensions("chart", mode),
        annotationExtension,
        ...getBuiltinEditorContributionExtensions("note-links", mode),
        ...(renderMarkdownAutocomplete ? [renderMarkdownAutocomplete] : []),
        ...getBuiltinEditorContributionExtensions("block-references", mode),
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
        ...getBuiltinEditorContributionExtensions("chart", mode),
        annotationExtension,
        ...getBuiltinEditorContributionExtensions("note-links", mode),
        ...getBuiltinEditorContributionExtensions("block-references", mode),
      ];
  }
}



