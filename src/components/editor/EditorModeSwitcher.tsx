import { For, Show } from 'solid-js';
import { editorStore } from '../../stores/editor';

export function EditorModeSwitcher() {
  const modes = () =>
    editorStore.state.fileKind === 'text-source'
      ? [{ value: 'edit-source' as const, name: 'Source' }]
      : [
          { value: 'view' as const, name: 'Read' },
          ...(!editorStore.state.isReadOnly
            ? [
                { value: 'edit-render' as const, name: 'Write' },
                { value: 'edit-source' as const, name: 'Source' },
              ]
            : []),
        ];
  return (
    <div class="editor-mode-island" role="group" aria-label="Editor mode">
      <For each={modes()}>
        {(mode) => (
          <button
            type="button"
            class="editor-mode-icon"
            aria-label={mode.name}
            title={mode.name}
            aria-pressed={
              editorStore.state.fileKind === 'text-source' || editorStore.state.mode === mode.value
            }
            onClick={() => editorStore.setMode(mode.value)}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <Show when={mode.value === 'view'}>
                <path d="M12 5c-3-2-7-2-10-1v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Zm0 0v15" />
              </Show>
              <Show when={mode.value === 'edit-render'}>
                <path d="m16 3 5 5M4 20l5-1L21 7a2 2 0 0 0-5-4L4 15Zm0 0 1-5" />
              </Show>
              <Show when={mode.value === 'edit-source'}>
                <path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 4l-4 16" />
              </Show>
            </svg>
          </button>
        )}
      </For>
    </div>
  );
}
