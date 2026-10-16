import { Compartment, type Extension } from '@codemirror/state';
import {
  EditorView,
  ViewPlugin,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from '@codemirror/view';
import {
  HighlightStyle,
  syntaxHighlighting,
  LanguageDescription,
  bracketMatching,
  foldGutter,
} from '@codemirror/language';
import { codeLanguages } from './code-languages';
import { tags } from '@lezer/highlight';
import './code-presentation.css';

export const codeSyntaxHighlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, class: 'cm-token-keyword' },
    { tag: tags.modifier, class: 'cm-token-modifier' },
    { tag: tags.variableName, class: 'cm-token-variable' },
    { tag: [tags.string, tags.attributeValue], class: 'cm-token-string' },
    { tag: [tags.number, tags.bool, tags.null], class: 'cm-token-number' },
    { tag: tags.comment, class: 'cm-token-comment' },
    { tag: [tags.typeName, tags.className, tags.tagName], class: 'cm-token-type' },
    { tag: [tags.propertyName, tags.attributeName], class: 'cm-token-property' },
    {
      tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
      class: 'cm-token-function',
    },
    { tag: tags.invalid, class: 'cm-token-invalid' },
  ])
);

export function sourceLanguageDescription(path: string): LanguageDescription | null {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? '';
  return (
    LanguageDescription.matchFilename(codeLanguages, name) ??
    LanguageDescription.matchFilename(codeLanguages, name.toLowerCase())
  );
}

export function sourceCodeExtensions(path: string): Extension {
  const language = new Compartment();
  const description = sourceLanguageDescription(path);
  const loader = ViewPlugin.define((view) => {
    let active = true;
    if (description)
      void description
        .load()
        .then((support) => {
          if (active) view.dispatch({ effects: language.reconfigure(support) });
        })
        .catch(() => {
          /* Unavailable grammars still open as plain text. */
        });
    return {
      destroy() {
        active = false;
      },
    };
  });
  return [
    EditorView.editorAttributes.of({ class: 'cm-source-editor' }),
    lineNumbers({
      domEventHandlers: {
        mousedown(view, line, event) {
          if (
            !(event instanceof MouseEvent) ||
            event.button !== 0 ||
            event.shiftKey ||
            event.ctrlKey ||
            event.metaKey
          )
            return false;
          view.dispatch({ selection: { anchor: line.from } });
          view.focus();
          return true;
        },
      },
    }),
    foldGutter(),
    bracketMatching(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    language.of([]),
    loader,
  ];
}
