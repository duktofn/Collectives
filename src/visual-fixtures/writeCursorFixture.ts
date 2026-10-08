import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { baseEditorExtensions, getExtensionsForMode } from '../lib/cm-extensions/markdown-mode';

export const WRITE_CURSOR_DOCUMENT = [
  'Start here.',
  '',
  '# A rendered heading',
  '',
  'A paragraph with **bold words** and *italic words* followed by plain text.',
  '',
  'A longer paragraph has **formatted words** in its middle and enough extra text to wrap several times on a narrow editor before reaching the final tail.',
  '',
  '```typescript',
  "const greeting = 'hello';",
  'console.log(greeting);',
  '```',
  '',
  'End of the document.',
].join('\n');

export function mountWriteCursorFixture(target: HTMLElement) {
  const view = new EditorView({
    state: EditorState.create({
      doc: WRITE_CURSOR_DOCUMENT,
      extensions: [...baseEditorExtensions, ...getExtensionsForMode('edit-render')],
    }),
    parent: target,
  });
  Object.assign(window, { __writeCursorView: view });
  return view;
}

export function viewForElement(element: HTMLElement) {
  return EditorView.findFromDOM(element);
}
