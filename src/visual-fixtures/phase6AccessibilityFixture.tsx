import { For, Show, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { ContextMenu } from "../components/common/ContextMenu";
import { Dialog } from "../components/common/Dialog";
import { MoveTargetRadioGroup, type MoveTargetOption } from "../components/common/MoveTargetRadioGroup";
import { Editor } from "../components/editor/Editor";
import { ThemePanel } from "../components/theme/ThemePanel";
import { TreeNode } from "../components/tree/TreeNode";
import { uiStore } from "../stores/ui";
import type { Entry, Settings } from "../types";

const syntheticOptions: MoveTargetOption[] = [
  { id: "root", name: "Collection Root", path: [] },
  { id: "archive", name: "Archive", path: [0] },
];

function syntheticEntries(size: number): Entry[] {
  return Array.from({ length: size }, (_, index) => ({ type: "file", id: `phase6-file-${index}`, path: `/synthetic/Note-${index}.md` }));
}

export function Phase6AccessibilityFixture() {
  return (
    <main aria-label="Phase 6 accessibility fixture">
      <div role="tree" aria-label="Fixture notes">
        <div role="treeitem" aria-level="1" aria-expanded="true" tabIndex={0}>Notes</div>
        <div role="group">
          <div role="treeitem" aria-level="2" tabIndex={-1}>Alpha.md</div>
          <div role="treeitem" aria-level="2" aria-disabled="true" tabIndex={-1}>Unsupported.bin</div>
        </div>
      </div>
      <button type="button" aria-haspopup="menu">Actions</button>
      <div role="menu" aria-label="Fixture actions">
        <button type="button" role="menuitem">Open</button>
        <div role="separator" />
        <button type="button" role="menuitem">Remove</button>
      </div>
    </main>
  );
}

export function mountPhase6AccessibilityFixture(target: HTMLElement): () => void {
  const [collectionSize, setCollectionSize] = createSignal(4);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [moveOpen, setMoveOpen] = createSignal(false);
  const [themeOpen, setThemeOpen] = createSignal(false);
  const [selectedMoveTarget, setSelectedMoveTarget] = createSignal("root");
  const events: string[] = [];
  const settings: Settings = { theme: "dark", fontScale: 1, customFonts: [] };
  const record = (event: string) => events.push(event);
  const groupEntry = (): Extract<Entry, { type: "group" }> => ({ type: "group", id: "phase6-group", name: "Synthetic Collection", children: syntheticEntries(collectionSize()) });
  const requestSelect = async (entryId: string | null) => { if (entryId) record(`open:${entryId}`); return true; };
  const requestFolderRefSelect = async () => true;
  const reset = () => {
    setCollectionSize(4);
    setMenuOpen(false);
    setMoveOpen(false);
    setThemeOpen(false);
    setSelectedMoveTarget("root");
    uiStore.setExpanded("phase6-group", false);
    events.length = 0;
  };
  const dispose = render(() => (
    <div data-phase6-harness="true" data-phase6-harness-ready="true">
      <section data-phase6-surface="collection">
        <div role="tree" aria-label="Synthetic collection tree">
          <Show when={collectionSize() <= 64} fallback={<For each={syntheticEntries(collectionSize())}>{(entry) => <div role="treeitem" aria-level="1" tabIndex={-1} data-phase6-large-row="true">{entry.type === "file" ? entry.path : entry.id}</div>}</For>}>
            <TreeNode entry={groupEntry()} depth={0} parentPath={[]} index={0} requestSelect={requestSelect} requestFolderRefSelect={requestFolderRefSelect} />
          </Show>
        </div>
        <button type="button" data-action="render-collection-1k" onClick={() => setCollectionSize(1_000)}>Render 1k</button>
        <button type="button" data-action="render-collection-10k" onClick={() => setCollectionSize(10_000)}>Render 10k</button>
      </section>

      <section data-phase6-surface="context-menu">
        <button type="button" data-action="open-context-menu" onClick={() => setTimeout(() => setMenuOpen(true), 0)} onContextMenu={(event) => { event.preventDefault(); setTimeout(() => setMenuOpen(true), 0); }}>Open context menu</button>
        <ContextMenu x={12} y={12} isOpen={menuOpen()} onClose={() => setMenuOpen(false)} items={[{ label: "Synthetic action", onClick: () => record("context-menu-action") }]} />
      </section>

      <section data-phase6-surface="modal">
        <button type="button" data-action="open-move-dialog" onClick={() => setMoveOpen(true)}>Move to…</button>
        <Show when={moveOpen()}>
          <Dialog isOpen={true} title="Move to" type="confirm" onConfirm={() => { record(`move:${selectedMoveTarget()}`); setMoveOpen(false); }} onClose={() => setMoveOpen(false)}>
            <MoveTargetRadioGroup name="phase6-move-target" options={syntheticOptions} selectedId={selectedMoveTarget()} onChange={setSelectedMoveTarget} onConfirm={() => { record(`move:${selectedMoveTarget()}`); setMoveOpen(false); }} />
          </Dialog>
        </Show>
      </section>

      <section data-phase6-surface="settings">
        <button type="button" data-action="open-theme" onClick={() => setThemeOpen(true)}>Theme settings</button>
        <ThemePanel isOpen={themeOpen()} onClose={() => setThemeOpen(false)} settings={settings} onSettingsChange={() => record("theme-change")} />
      </section>

      <section data-phase6-surface="editor">
        <Editor />
      </section>
    </div>
  ), target);

  const harness = {
    reset,
    events: () => [...events],
    lastAction: () => events[events.length - 1] ?? "",
    collectionSize: () => collectionSize(),
  };
  (window as unknown as { __phase6Harness?: typeof harness }).__phase6Harness = harness;
  return () => {
    delete (window as unknown as { __phase6Harness?: typeof harness }).__phase6Harness;
    dispose();
  };
}

export type Phase6Harness = ReturnType<typeof mountPhase6AccessibilityFixture>;
