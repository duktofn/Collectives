import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  type StreamParser,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';

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
      // Attributes and namespaces keep normal text, while declarations expose their types.
      if (/^\s*\[[\w.\s,]*$/.test(before) || /^\s*(?:using|namespace)\s/.test(before))
        return 'meta';
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
      return 'variable';
    },
  };
  return new LanguageSupport(StreamLanguage.define(parser));
}

/** Use the same language support for standalone files and Markdown fences. */
export const codeLanguages = languages.map((description) =>
  description.name === 'C#'
    ? LanguageDescription.of({
        name: 'C#',
        alias: ['csharp', 'cs'],
        extensions: ['cs'],
        load: loadCSharp,
      })
    : description
);
