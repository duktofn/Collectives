import { afterEach, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { forceParsing, syntaxTree } from '@codemirror/language';
import { baseEditorExtensions, getExtensionsForMode } from './markdown-mode';

vi.mock('../../features/links', () => ({
  resolveWikilink: vi.fn(async () => null),
  searchLinkIndex: vi.fn(async () => []),
}));

const mounted: EditorView[] = [];
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
