import { afterEach, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { redo, undo } from '@codemirror/commands';
import { baseEditorExtensions, getExtensionsForMode } from './markdown-mode';
import { inlineFormattingAt } from './inline-formatting';

const mounted: EditorView[] = [];
afterEach(() => {
  for (const view of mounted.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
});

function mount(source: string, mode: 'edit-render' | 'edit-source' | 'view' = 'edit-render') {
  const head = source.indexOf('|');
  const doc = source.replace('|', '');
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({ parent, state: EditorState.create({ doc,
    selection: { anchor: head }, extensions: [...baseEditorExtensions, ...getExtensionsForMode(mode)] }) });
  mounted.push(view);
  return view;
}

function enter(view: EditorView) {
  return runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }), 'editor');
}

it.each([
  ['**hello |**', '.cm-strong'],
  ['1. **Khi in đậm thì xuống dòng như thế này |**', '.cm-strong'],
  ['*hello |*', '.cm-emphasis'],
  ['__hello |__', '.cm-strong'],
  ['_hello |_', '.cm-emphasis'],
  ['~~hello |~~', '.cm-strikethrough'],
  ['**hello \t|**', '.cm-strong'],
  ['**one** and __two |__', '.cm-strong'],
])('styles draft whitespace in %s without modifying source', (source, css) => {
  const view = mount(source);
  const doc = source.replace('|', '');
  const drafts = inlineFormattingAt(view.state, view.state.selection.main.head).filter((span) => span.draft);
  expect(drafts).toHaveLength(1);
  const draft = drafts[0];
  expect(Array.from(view.dom.querySelectorAll(css)).some((element) => element.textContent === doc.slice(draft.from, draft.to))).toBe(true);
  expect(view.state.doc.toString()).toBe(doc);
});

it.each([
  '`**hello |**`',
  '```text\n**hello |**\n```',
  '    **hello |**',
  '\\*\\*hello |**',
  '[link](https://example.com/**hello |**)',
])('does not recover formatting inside code, escapes, or link destinations: %s', (source) => {
  const view = mount(source);
  expect(inlineFormattingAt(view.state, view.state.selection.main.head).filter((span) => span.draft)).toEqual([]);
});

it.each([
  ['**bold|**', '**bold**\n'],
  ['1. **bold |**', '1. **bold**\n2. '],
  ['- *italic |*', '- *italic*\n- '],
  ['~~strike |~~', '~~strike~~ \n'],
  ['__bold |__', '__bold__ \n'],
  ['***both |***', '***both*** \n'],
  ['**bold *italic|***', '**bold *italic***\n'],
  ['**bold|**  ', '**bold**  \n'],
  ['**|**', '\n'],
  ['** |**', '\n'],
  ['1. **|**', ''],
  ['1. ** |**', ''],
  ['*|*', '\n'],
  ['* |*', '\n'],
  ['- * |*', ''],
])('Enter finishes inline formatting as one undoable edit: %s', (source, expected) => {
  const view = mount(source);
  const before = view.state.doc.toString();
  expect(enter(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(expected);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(before);
  expect(redo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(expected);
});

it.each([
  ['**bo|ld**', 'edit-render', '**bo\nld**'],
  ['**bold|**', 'edit-source', '**bold\n**'],
  ['`code|`', 'edit-render', '`code\n`'],
  ['```text\n**code|**\n```', 'edit-render', '```text\n**code\n**\n```'],
] as const)('keeps ordinary Enter for mid-content and source/code editing: %s', (source, mode, expected) => {
  const view = mount(source, mode);
  enter(view);
  expect(view.state.doc.toString()).toBe(expected);
});

it('moves draft trailing whitespace outside the closer when the cursor leaves, preserving content and undo', () => {
  const view = mount('**hello |** after');
  view.dispatch({ selection: { anchor: 10 } });
  expect(view.state.doc.toString()).toBe('**hello**  after');
  expect(view.state.selection.main.head).toBe(10);
  expect(view.dom.querySelector('.cm-strong')?.textContent).toBe('hello');
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe('**hello ** after');
});

it('keeps whitespace in place while moving within draft content and in Source mode', () => {
  const write = mount('**hello |** after');
  write.dispatch({ selection: { anchor: 4 } });
  expect(write.state.doc.toString()).toBe('**hello ** after');
  const source = mount('**hello |** after', 'edit-source');
  source.dispatch({ selection: { anchor: 10 } });
  expect(source.state.doc.toString()).toBe('**hello ** after');
});

it('commits nested bold/italic closing markers together when leaving a whitespace draft', () => {
  const view = mount('***both |***');
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  expect(view.state.doc.toString()).toBe('***both*** ');
});
