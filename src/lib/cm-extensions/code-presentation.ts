import { Compartment, type Extension } from '@codemirror/state';
import {
  EditorView,
  ViewPlugin,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import {
  HighlightStyle,
  syntaxHighlighting,
  LanguageDescription,
  bracketMatching,
  foldGutter,
  syntaxTree,
} from '@codemirror/language';
import { codeLanguages } from './code-languages';
import { tags } from '@lezer/highlight';
import './code-presentation.css';

const syntaxColors = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, class: 'cm-token-keyword' },
    { tag: tags.modifier, class: 'cm-token-modifier' },
    { tag: [tags.variableName, tags.self], class: 'cm-token-variable' },
    { tag: [tags.string, tags.character, tags.attributeValue], class: 'cm-token-string' },
    { tag: [tags.number, tags.bool, tags.null], class: 'cm-token-number' },
    { tag: tags.comment, class: 'cm-token-comment' },
    { tag: [tags.typeName, tags.className, tags.tagName], class: 'cm-token-type' },
    { tag: [tags.propertyName, tags.attributeName], class: 'cm-token-property' },
    { tag: [tags.annotation, tags.meta], class: 'cm-token-annotation' },
    {
      tag: [tags.macroName, tags.processingInstruction, tags.special(tags.name)],
      class: 'cm-token-macro',
    },
    {
      tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
      class: 'cm-token-function',
    },
    { tag: tags.invalid, class: 'cm-token-invalid' },
  ])
);

// Some grammars share identifier tags between variables and declarations.
// Use syntax context to distinguish their roles without guessing identifier names.
function declarationRoles(view: EditorView): DecorationSet {
  const marks: { from: number; to: number; value: Decoration }[] = [];
  const seen = new Set<number>();
  for (const range of view.visibleRanges)
    syntaxTree(view.state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (seen.has(node.from)) return;
        const parent = node.node.parent?.name;
        let role: 'function' | 'type' | 'annotation' | 'macro' | null = null;
        if (node.name === 'Definition') {
          if (parent === 'MethodDeclaration' || parent === 'ConstructorDeclaration')
            role = 'function';
          else if (
            parent === 'ClassDeclaration' ||
            parent === 'InterfaceDeclaration' ||
            parent === 'EnumDeclaration'
          )
            role = 'type';
        } else if (node.name === 'BoundIdentifier' && parent === 'FunctionItem') role = 'function';
        else if (node.name === 'VariableName') {
          if (parent === 'FunctionDefinition' || parent === 'CallExpression') role = 'function';
          else if (parent === 'ClassDefinition' || parent === 'TypeDef') role = 'type';
          else if (parent === 'Decorator') role = 'annotation';
        } else if (node.name === 'Identifier' || node.name === 'FieldIdentifier') {
          if (
            parent === 'FunctionDeclarator' ||
            parent === 'CallExpression' ||
            parent === 'MethodName'
          )
            role = 'function';
          else if (parent === 'MacroInvocation' || parent === 'MacroDefinition') role = 'macro';
          else if (parent === 'MetaItem' || parent === 'AttributeName') role = 'annotation';
        }
        if (!role) return;
        seen.add(node.from);
        marks.push({
          from: node.from,
          to: node.to,
          value: Decoration.mark({ class: `cm-token-${role} cm-code-role-${role}` }),
        });
      },
    });
  return Decoration.set(marks, true);
}

const declarationHighlighting = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = declarationRoles(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      )
        this.decorations = declarationRoles(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations }
);

export const codeSyntaxHighlighting = [syntaxColors, declarationHighlighting];

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
