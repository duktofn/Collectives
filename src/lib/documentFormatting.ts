import { fileExtension } from '../shared/fileCapabilities.generated';

export function canFormatDocument(path: string): boolean {
  return ['json', 'html', 'htm'].includes(fileExtension(path));
}

function formatJson(source: string): string {
  // Validate first, but keep the original tokens instead of serializing parsed numbers.
  JSON.parse(source);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const output: string[] = [];
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let previous = '';
  const nextLine = () => output.push(newline, '  '.repeat(depth));
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      output.push(character);
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') {
        quoted = false;
        previous = '"';
      }
    } else if (character === '"') {
      quoted = true;
      output.push(character);
    } else if (!/\s/.test(character)) {
      if (character === '{' || character === '[') {
        output.push(character);
        depth++;
        const closing = character === '{' ? '}' : ']';
        let next = index + 1;
        while (/\s/.test(source[next] ?? '') && next < source.length) next++;
        if (source[next] !== closing) nextLine();
      } else if (character === '}' || character === ']') {
        depth--;
        if (previous !== '{' && previous !== '[') nextLine();
        output.push(character);
      } else if (character === ',') {
        output.push(character);
        nextLine();
      } else if (character === ':') output.push(': ');
      else output.push(character);
      previous = character;
    }
  }
  return output.join('') + newline;
}

export async function formatDocumentSource(source: string, path: string): Promise<string> {
  if (!canFormatDocument(path))
    throw new Error('Formatting is available for JSON and HTML documents.');
  if (fileExtension(path) === 'json') return formatJson(source);
  const prettier = await import('prettier/standalone');
  const plugins = [(await import('prettier/plugins/html')).default];
  return prettier.format(source, {
    parser: 'html',
    plugins,
    tabWidth: 2,
    printWidth: 100,
    htmlWhitespaceSensitivity: 'css',
    endOfLine: 'auto',
  });
}
