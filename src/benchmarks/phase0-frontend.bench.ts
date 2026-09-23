/* global document */
import { bench, describe, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { parseWikilink, serializeWikilink } from '../lib/wikilink/parser';
import { navigateToFragment } from '../lib/wikilink/resolver';
import { wikilinkDecorationExtension } from '../lib/cm-extensions/wikilink-decoration';
import { renderDecorationsExtension } from '../lib/cm-extensions/render-decorations';
import { REPRO_DOCS } from '../lib/cm-extensions/heightmap-test-fixtures';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn(), message: vi.fn() }));

const wikilinkInputs = [
  '[[Note 1]]',
  '[[Nested/Note.md#Heading]]',
  '[[Note 3#^block123]]',
  '[[A note with spaces]]',
];
const resolverState = EditorState.create({ doc: '# Target\n\nA paragraph\n^block123\n' });
const resolverView = {
  state: resolverState,
  dispatch: vi.fn(),
  focus: vi.fn(),
} as unknown as EditorView;

describe('Phase 0 frontend benchmarks — pure-algorithm', () => {
  bench('pure-algorithm/parser-and-label-roundtrip', () => {
    for (const input of wikilinkInputs) {
      const token = parseWikilink(input);
      if (!token) throw new Error(`Parser rejected benchmark input: ${input}`);
      serializeWikilink(token);
    }
  });

  bench('pure-algorithm/resolver-fragment-navigation', () => {
    navigateToFragment(resolverView, { type: 'heading', value: 'Target' });
    navigateToFragment(resolverView, { type: 'block', value: 'block123' });
  });
});

describe('Phase 0 frontend benchmarks — jsdom-proxy', () => {
  bench('jsdom-proxy/CodeMirror-wikilink-decoration', () => {
    const parent = document.createElement('div');
    const view = new EditorView({
      state: EditorState.create({ doc: `${REPRO_DOCS.heading}\n\n[[Note 1]]`, extensions: [markdown(), wikilinkDecorationExtension] }),
      parent,
    });
    view.dispatch({ changes: { from: 0, insert: '[[Benchmark]]\n' } });
    view.destroy();
  });

  bench('jsdom-proxy/CodeMirror-render-decoration-heightmap', () => {
    const parent = document.createElement('div');
    const view = new EditorView({
      state: EditorState.create({ doc: REPRO_DOCS.table, extensions: [markdown(), renderDecorationsExtension] }),
      parent,
    });
    view.dispatch({ changes: { from: 0, insert: `${REPRO_DOCS.codeBlock}\n` } });
    view.destroy();
  });
});

// These labels are algorithm and jsdom-proxy measurements only. They are not native WebView/UI-visible timings.
