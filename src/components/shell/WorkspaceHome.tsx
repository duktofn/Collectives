import { For, Show } from 'solid-js';
import type { ResolveCandidate } from '../../types';
import { Icon } from '../common/Icon';

interface WorkspaceHomeProps {
  collectionName: string;
  notes: ResolveCandidate[];
  onNewNote: () => void;
  onQuickOpen: () => void;
  onOpen: (note: ResolveCandidate) => Promise<boolean>;
}

export function WorkspaceHome(props: WorkspaceHomeProps) {
  return (
    <section class="workspace-home" aria-labelledby="workspace-home-title">
      <div class="workspace-home-heading">
        <span class="workspace-eyebrow">Your workspace</span>
        <h1 id="workspace-home-title">{props.collectionName}</h1>
        <p>Pick up an idea, or start a new one.</p>
        <div class="workspace-home-actions">
          <button type="button" class="btn btn-primary" onClick={props.onNewNote}>
            <Icon name="plus" size={16} />
            New note
          </button>
          <button type="button" class="btn" onClick={props.onQuickOpen}>
            <Icon name="search" size={16} />
            Find a note
          </button>
        </div>
      </div>
      <Show
        when={props.notes.length}
        fallback={
          <div class="workspace-home-first-note">
            <Icon name="file" size={24} />
            <h2>A little space for your ideas</h2>
            <p>Create your first note or add existing Markdown files from the sidebar.</p>
          </div>
        }
      >
        <div class="workspace-home-notes">
          <h2>
            <Icon name="folder" size={16} />
            Notes in this collection
          </h2>
          <For each={props.notes.slice(0, 5)}>
            {(note) => (
              <button
                type="button"
                class="workspace-home-note"
                title={note.path}
                onClick={() => void props.onOpen(note)}
              >
                <Icon name="file" size={18} />
                <span>
                  <strong>{note.displayName}</strong>
                  <small>{note.path}</small>
                </span>
                <Icon name="chevron-right" size={16} />
              </button>
            )}
          </For>
        </div>
      </Show>
      <p class="workspace-home-tip">
        <kbd>Ctrl P</kbd> to find a note · <kbd>Ctrl N</kbd> to start writing
      </p>
    </section>
  );
}
