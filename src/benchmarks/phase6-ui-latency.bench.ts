/* global document */
import { bench, describe } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

function renderSyntheticCollection(size: number): number {
  const rows = Array.from({ length: size }, (_, index) => ({ id: `entry-${index}`, label: `Note ${index}` }));
  return rows.reduce((total, row) => total + row.label.length, 0);
}

describe("Phase 6 UI latency synthetic-proxy baseline", () => {
  for (const size of [100, 1_000, 10_000]) {
    bench(`synthetic-proxy/collection-render-${size}`, () => { void renderSyntheticCollection(size); });
  }

  for (const [label, size] of [['100KiB', 100 * 1024], ['1MiB', 1024 * 1024]] as const) {
    bench(`synthetic-proxy/text-source-update-${label}`, () => {
      const text = 'x'.repeat(size);
      if (text.length !== size || text.charCodeAt(size - 1) !== 120) throw new Error('Synthetic text fixture changed');
    });
  }

  bench("synthetic-proxy/50-cycle-editor-open-close-proxy", () => {
    const host = document.createElement('div');
    for (let index = 0; index < 50; index += 1) {
      const mount = document.createElement('div');
      host.append(mount);
      const view = new EditorView({ state: EditorState.create({ doc: `# Cycle ${index}\n\nEditor open/close proxy.` }), parent: mount });
      view.destroy();
      mount.remove();
    }
    host.remove();
  });
});
