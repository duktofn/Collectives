import { afterEach, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { forceParsing, syntaxTree } from '@codemirror/language';
import { baseEditorExtensions, getExtensionsForMode } from './markdown-mode';

vi.mock('../../features/links', () => ({
  resolveWikilink: vi.fn(async () => null),
  searchLinkIndex: vi.fn(async () => []),
}));

const mounted: EditorView[] = [];

function mountInline(doc: string, anchor: number, mode: 'edit-render' | 'view' = 'edit-render') {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc, selection: { anchor },
      extensions: [EditorState.allowMultipleSelections.of(true), ...baseEditorExtensions, ...getExtensionsForMode(mode)],
    }),
  });
  mounted.push(view);
  return view;
}

function atomicRanges(view: EditorView) {
  const hidden: { from: number; to: number }[] = [];
  for (const source of view.state.facet(EditorView.atomicRanges)) {
    source(view).between(0, view.state.doc.length, (from, to) => { hidden.push({ from, to }); });
  }
  return hidden;
}

it.each([1, 2, 3, 4, 5, 6])('reveals level %i heading markers only while active in Write', (level) => {
  const heading = '#'.repeat(level) + ' Heading';
  const doc = heading + '\n\nOutside';
  const view = mountInline(doc, doc.length);
  expect(view.dom.querySelector('.cm-heading')?.textContent).toBe('Heading');
  view.dispatch({ selection: { anchor: 0 } });
  expect(view.dom.querySelector('.cm-heading')?.textContent).toBe(heading);
  expect(atomicRanges(view)).toEqual([]);
  view.dispatch({ selection: { anchor: heading.length } });
  expect(view.dom.querySelector('.cm-heading')?.textContent).toBe(heading);
  view.dispatch({ selection: { anchor: doc.length } });
  expect(view.dom.querySelector('.cm-heading')?.textContent).toBe('Heading');
  expect(view.state.doc.toString()).toBe(doc);
  expect(mountInline(doc, level + 2, 'view').dom.querySelector('.cm-heading')?.textContent).toBe('Heading');
});

it('reveals heading markers for a selection intersecting its text', () => {
  const view = mountInline('## Heading\n\nOutside', 19);
  view.dispatch({ selection: EditorSelection.single(4, 15) });
  expect(view.dom.querySelector('.cm-heading')?.textContent).toBe('## Heading');
});

it.each([
  ['**bold**', '.cm-strong', 2],
  ['__bold__', '.cm-strong', 2],
  ['*italic*', '.cm-emphasis', 1],
  ['_italic_', '.cm-emphasis', 1],
  ['~~deleted~~', '.cm-strikethrough', 2],
  ['`code`', '.cm-inline-code', 1],
  ['``a ` b``', '.cm-inline-code', 2],
] as const)('reveals %s while editing and restores hidden delimiters after leaving', (inline, selector, size) => {
  const view = mountInline(`${inline}\n\nOutside`, size + 1);
  expect(view.dom.querySelector(selector)?.textContent).toBe(inline);
  expect(atomicRanges(view)).toEqual([]);

  // Selection-only transactions must update both presentation and navigation.
  view.dispatch({ selection: { anchor: inline.length } });
  expect(view.dom.querySelector(selector)?.textContent).toBe(inline);
  view.dispatch({ selection: { anchor: inline.length + 2 } });
  expect(view.dom.querySelector(selector)?.textContent).toBe(inline.slice(size, -size));
  expect(atomicRanges(view)).toEqual([{ from: 0, to: size }, { from: inline.length - size, to: inline.length }]);
  view.dispatch({ selection: { anchor: size } });
  expect(view.dom.querySelector(selector)?.textContent).toBe(inline);
  expect(atomicRanges(view)).toEqual([]);
});

it.each(['****', '____', '** **', '__ __', '1. ****', '- ****'])('keeps empty formatting %s editable instead of rendering a divider', (doc) => {
  const view = mountInline(doc, doc.length - 2);
  expect(view.dom.querySelector('.cm-hr')).toBeNull();
  expect(view.contentDOM.textContent).toBe(doc);
  expect(atomicRanges(view)).toEqual([]);
});

it('keeps real dividers rendered outside an empty formatting pair and in Read mode', () => {
  expect(mountInline('****', 0).dom.querySelector('.cm-hr')).not.toBeNull();
  expect(mountInline('****', 2, 'view').dom.querySelector('.cm-hr')).not.toBeNull();
  expect(mountInline('---', 1).dom.querySelector('.cm-hr')).not.toBeNull();
  const read = mountInline('**bold**', 3, 'view');
  expect(read.dom.querySelector('.cm-strong')?.textContent).toBe('bold');
  expect(atomicRanges(read)).toHaveLength(2);
});

it('reveals nested formatting and only spans intersecting the selection', () => {
  const view = mountInline('**bold *italic*** and **other**', 9);
  expect(view.dom.querySelector('.cm-strong')?.textContent).toBe('**bold *italic***');
  expect(view.dom.querySelector('.cm-emphasis')?.textContent).toBe('*italic*');
  expect(view.dom.querySelectorAll('.cm-strong')[1]?.textContent).toBe('other');
  view.dispatch({ selection: EditorSelection.single(16, 23) });
  expect(view.dom.querySelectorAll('.cm-strong')[1]?.textContent).toBe('**other**');
});

it('reveals every inline span containing a cursor in a multiple selection', () => {
  const view = mountInline('**one** and *two*', 3);
  view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(3), EditorSelection.cursor(13)]) });
  expect(view.dom.querySelector('.cm-strong')?.textContent).toBe('**one**');
  expect(view.dom.querySelector('.cm-emphasis')?.textContent).toBe('*two*');
  expect(atomicRanges(view)).toEqual([]);
});
afterEach(() => {
  for (const view of mounted.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
  vi.restoreAllMocks();
});

it.each(['edit-render', 'view'] as const)(
  'refreshes heading rendering when parsing finishes after opening a file in %s',
  (mode) => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const extensions = [...baseEditorExtensions, ...getExtensionsForMode(mode)];
    const view = new EditorView({
      state: EditorState.create({ doc: 'First file.', extensions }), parent,
    });
    mounted.push(view);
    // The first block exceeds the parser's initial 3000-character budget.
    const source = `<!-- ${'x'.repeat(15_000)} -->\n\n## Heading after file switch\n`;
    view.setState(EditorState.create({ doc: source, extensions }));
    // JSDOM cannot measure the viewport. Keep the target visible without
    // triggering a viewport update that would also rebuild the decorations.
    vi.spyOn(view, 'visibleRanges', 'get').mockReturnValue([{ from: 0, to: source.length }]);
    expect(syntaxTree(view.state).toString()).not.toContain('ATXHeading');
    expect(view.dom.querySelector('.cm-heading-2')).toBeNull();
    const initialDocument = view.state.doc;
    const initialViewport = view.viewport;

    expect(forceParsing(view, source.length, 1000)).toBe(true);
    expect(syntaxTree(view.state).toString()).toContain('ATXHeading2');
    expect(view.viewport).toEqual(initialViewport);
    expect(view.state.doc).toBe(initialDocument);
    const hiddenMarkers: { from: number; to: number }[] = [];
    for (const ranges of view.state.facet(EditorView.atomicRanges)) {
      ranges(view).between(0, source.length, (from, to) => {
        hiddenMarkers.push({ from, to });
      });
    }
    const headingStart = source.indexOf('## ');
    expect(hiddenMarkers).toContainEqual({ from: headingStart, to: headingStart + 3 });
  },
);
