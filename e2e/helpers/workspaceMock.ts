import type { Page } from '@playwright/test';

/** Real App components with an isolated in-memory Tauri boundary; no user files. */
export async function installWorkspaceMock(
  page: Page,
  theme = 'dark',
  empty = false,
  overview = false,
  content?: string,
  preferences?: { fontScale?: number; lineHeight?: number; fontMono?: string }
) {
  await page.addInitScript(
    ({ theme, empty, overview, content, preferences }) => {
      const root = 'D:/Sample/Knowledge';
      const names = [
        'Product direction',
        'Research and references',
        'Weekly review',
        'Ideas for the next release',
        ...Array.from({ length: 26 }, (_, i) => `Research note ${i + 1}`),
      ];
      const notes = names.map((displayName, i) => ({
        displayName,
        path: `${root}/${displayName}.md`,
        entryId: `note-${i}`,
        entryType: 'file',
      }));
      const collection = {
        id: 'sample',
        schemaVersion: 1,
        name: 'Personal knowledge',
        createdAt: '2026-10-06',
        updatedAt: '2026-10-06',
        entries: [
          {
            id: 'projects',
            type: 'group',
            name: 'Projects',
            children: notes.slice(0, 4).map((n) => ({ id: n.entryId, type: 'file', path: n.path })),
          },
          ...notes.slice(4).map((n) => ({ id: n.entryId, type: 'file', path: n.path })),
        ],
      };
      const documentText =
        '# Product direction\n\nA quiet space to collect ideas, connect what you learn, and turn notes into something useful.\n\n## What matters this week\n\nKeep everyday writing simple. Make it easy to find the right note and pick up where you left off.\n\n- Capture an idea while it is fresh\n- Connect it to [[Research and references]]\n- Review the next step in [[Weekly review]]\n\n## Next steps\n\n- [ ] Review the navigation\n- [ ] Refine the writing experience\n- [ ] Share a working prototype\n\n## Notes to revisit\n\nGood tools leave room for your thinking. Start small, keep the useful parts, and come back to what matters.\n';
      const cursor = { streamId: 'sample', subscriptionEpoch: '1', sequence: 0 };
      let callbackId = 0;
      const commands: string[] = [];
      const internals = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: () => ++callbackId,
        unregisterCallback: () => {},
        convertFileSrc: (path: string) => path,
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          commands.push(command);
          if (command === 'update_collection') {
            collection.name = (args.collection as { name: string }).name;
            return null;
          }
          if (command === 'get_collections') return empty ? [] : [structuredClone(collection)];
          if (command === 'load_settings') return { theme, fontScale: 1, customFonts: [], ...preferences };
          if (command === 'get_fonts_dir') return `${root}/fonts`;
          if (command === 'validate_entries' || command === 'read_folder_children') return [];
          if (command === 'sync_collection_watches') return cursor;
          if (command === 'reconcile_collection_snapshot')
            return { collection: structuredClone(collection), revision: 0, cursor };
          if (command === 'read_file')
            return { content: content ?? documentText, versionToken: 'sample-v1', fileKind: 'markdown' };
          if (command === 'write_file' || command === 'create_file')
            return { versionToken: 'sample-v2' };
          if (command === 'resolve_wikilink')
            return notes.find((n) => n.displayName === args.noteName) ?? null;
          if (command === 'search_link_index')
            return notes.filter((n) =>
              n.displayName.toLowerCase().includes(String(args.query ?? '').toLowerCase())
            );
          if (command === 'search_note_content')
            return {
              results: [
                {
                  ...notes[0],
                  snippet: 'Review the navigation and writing experience.',
                  lineNumber: 18,
                  columnUtf16: 1,
                  matchStartUtf16: 11,
                  matchEndUtf16: 21,
                },
              ],
              offset: 0,
              limit: 20,
              total: 1,
              hasMore: false,
              truncated: false,
              scannedFiles: 30,
              skippedFiles: 0,
            };
          if (command === 'plugin:event|listen') return ++callbackId;
          if (command === 'plugin:dialog|open') return root;
          return null;
        },
      };
      Object.assign(window, {
        __TAURI_INTERNALS__: internals,
        __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
        __workspaceCommands: commands,
      });
      localStorage.clear();
      if (!empty) {
        localStorage.setItem('lastActiveCollectionId', 'sample');
        if (!overview) localStorage.setItem('lastSelectedEntryId', 'note-0');
      }
    },
    { theme, empty, overview, content, preferences }
  );
}
