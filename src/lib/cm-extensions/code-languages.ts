import {
  LanguageDescription,
  LRLanguage,
  LanguageSupport,
  StreamLanguage,
  type StreamParser,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { styleTags, tags } from '@lezer/highlight';

const modifiers = new Set(
  'public private protected internal static readonly const abstract sealed override virtual partial async extern unsafe volatile required file scoped ref out in params'.split(
    ' '
  )
);
const builtInTypes = new Set(
  'void Array List Dictionary HashSet IEnumerable IEnumerator IDisposable Exception Action Func Task ValueTask'.split(
    ' '
  )
);

async function loadCSharp() {
  const { csharp } = await import('@codemirror/legacy-modes/mode/clike');
  const parser: StreamParser<unknown> = {
    ...csharp,
    token(stream, state) {
      const style = csharp.token(stream, state);
      const word = stream.current();
      if (style === 'keyword' && modifiers.has(word)) return 'qualifier';
      if (style === 'type' || (style === 'keyword' && word === 'void')) return 'type';
      if (style !== 'variable' && style !== 'def' && style !== 'builtin') return style;
      const before = stream.string.slice(0, stream.start);
      const after = stream.string.slice(stream.pos);
      if (/^\s*\[[\w.\s,]*$/.test(before)) return 'annotation';
      if (/^\s*(?:using|namespace)\s/.test(before)) return 'namespace';
      if (
        builtInTypes.has(word) ||
        /\b(?:class|struct|interface|enum|record|new|as|is)\s+(?:[\w]+\.)*$/.test(before)
      )
        return 'type';
      if (
        /^[A-Z]/.test(word) &&
        (/^\s*(?:\?\s*|\[[,\s]*\]\s*)*[\p{L}_@][\p{L}\p{N}_@]*/u.test(after) ||
          /^\s*</.test(after) ||
          /[<,]\s*$/.test(before))
      )
        return 'type';
      if (/^\s*\(/.test(after)) return 'variableName.function';
      if (/\.\s*$/.test(before)) return 'propertyName';
      return 'variable';
    },
  };
  return new LanguageSupport(StreamLanguage.define(parser));
}

const languageRoles = {
  Java: {
    'MarkerAnnotation/Identifier NormalAnnotation/Identifier': tags.annotation,
    'ClassDeclaration/Definition InterfaceDeclaration/Definition EnumDeclaration/Definition':
      tags.definition(tags.typeName),
    'MethodDeclaration/Definition ConstructorDeclaration/Definition': tags.function(
      tags.definition(tags.variableName)
    ),
  },
  Rust: {
    'MacroInvocation/Identifier MacroDefinition/Identifier': tags.macroName,
    'MetaItem/Identifier Attribute/MetaItem/ParenthesizedTokens/Identifier': tags.annotation,
  },
  Python: {
    'Decorator/VariableName Decorator/MemberExpression/PropertyName': tags.annotation,
    'TypeDef/VariableName': tags.typeName,
  },
  'C++': { 'AttributeName/Identifier': tags.annotation },
};

/** Use the same language support for standalone files, previews and Markdown fences. */
export const codeLanguages = languages.map((description) => {
  if (description.name === 'C#')
    return LanguageDescription.of({
      name: 'C#',
      alias: ['csharp', 'cs'],
      extensions: ['cs'],
      load: loadCSharp,
    });
  const roles = languageRoles[description.name as keyof typeof languageRoles];
  if (!roles) return description;
  return LanguageDescription.of({
    name: description.name,
    alias: description.alias,
    extensions: description.extensions,
    filename: description.filename,
    load: async () => {
      const support = await description.load();
      if (!(support.language instanceof LRLanguage)) return support;
      return new LanguageSupport(
        support.language.configure({ props: [styleTags(roles)] }),
        support.support
      );
    },
  });
});
