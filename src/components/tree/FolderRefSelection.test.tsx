import { render, cleanup } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { FolderRefChildRow } from './FolderRefChildRow';
import { uiStore } from '../../stores/ui';
import { editorStore } from '../../stores/editor';

vi.mock('../../stores/editor', () => ({ editorStore: { state: { openFilePath: 'b.md' } } }));
vi.mock('../../features/filesystem/folderRefReadiness', () => ({
  getFolderRefReadiness: () => ({ status: 'ready' }), retryFolderRefChild: vi.fn(),
}));
afterEach(() => { cleanup(); uiStore.selectEntry(null); });

it('keeps only the actual open folder file highlighted even when both are ready', () => {
  uiStore.selectEntry('b.md');
  const props = { depth: 1, collectionId: 'collection', folderRefEntryId: 'folder', rootPath: 'root', requestSelect: vi.fn(async () => true) };
  render(() => <>
    <FolderRefChildRow {...props} item={{ name: 'a.md', path: 'a.md', isDir: false }} />
    <FolderRefChildRow {...props} item={{ name: 'b.md', path: 'b.md', isDir: false }} />
  </>);
  expect(document.querySelectorAll('.tree-node.selected')).toHaveLength(1);
  expect(document.querySelector('[data-folderref-child="b.md"] .tree-node')?.classList.contains('selected')).toBe(true);
  Object.assign(editorStore.state, { openFilePath: 'a.md' });
  uiStore.selectEntry('a.md');
  expect(document.querySelectorAll('.tree-node.selected')).toHaveLength(1);
  expect(document.querySelector('[data-folderref-child="a.md"] .tree-node')?.getAttribute('aria-selected')).toBe('true');
  expect(document.querySelector('[data-folderref-child="b.md"] .tree-node')?.classList.contains('selected')).toBe(false);
});
