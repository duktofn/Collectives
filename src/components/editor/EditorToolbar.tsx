import { createSignal, onCleanup, Show } from 'solid-js';
import { editorStore } from '../../stores/editor';
import { uiStore } from '../../stores/ui';
import { Icon } from '../common/Icon';
import { collectionsStore } from '../../stores/collections';
import { requestDocumentFormat } from '../../lib/editorCommands';
import { canFormatDocument } from '../../lib/documentFormatting';

interface EditorToolbarProps {
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  onBack: () => void;
  onForward: () => void;
}

export function EditorToolbar(props: EditorToolbarProps) {
  const [message, setMessage] = createSignal('');
  const [formatting, setFormatting] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  const getFileName = () =>
    editorStore.state.openFilePath?.split(/[/\\]/).pop()?.replace(/\.md$/i, '') ?? '';
  const getBreadcrumb = () => {
    const parts = editorStore.state.openFilePath?.split(/[/\\]/).filter(Boolean) ?? [];
    return [collectionsStore.activeCollection()?.name, parts.slice(0, -1).slice(-2).join(' / ')]
      .filter(Boolean)
      .join(' / ');
  };
  const saveLabel = () =>
    editorStore.state.error || editorStore.state.conflictKind
      ? 'Save needs attention'
      : editorStore.state.isSaving
        ? 'Saving'
        : 'Unsaved changes';
  const formatDocument = async () => {
    if (formatting()) return;
    setFormatting(true);
    try {
      if (await requestDocumentFormat()) setMessage('Document formatted');
    } catch (error) {
      setMessage(`Could not format: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setFormatting(false);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(''), 3000);
    }
  };
  return (
    <div class="editor-toolbar">
      <div class="editor-document-context">
        <div class="editor-navigation" aria-label="Document history">
          <button
            class="editor-nav-btn"
            type="button"
            aria-label="Back"
            title="Back (Alt+Left outside text fields)"
            disabled={!props.canGoBack()}
            onClick={props.onBack}
          >
            <Icon name="chevron-left" size={16} />
          </button>
          <button
            class="editor-nav-btn"
            type="button"
            aria-label="Forward"
            title="Forward (Alt+Right outside text fields)"
            disabled={!props.canGoForward()}
            onClick={props.onForward}
          >
            <Icon name="chevron-right" size={16} />
          </button>
        </div>
        <div class="editor-title-container">
          <div class="editor-file-details">
            <Show when={getBreadcrumb()}>
              <span class="editor-breadcrumb" title={getBreadcrumb()}>
                {getBreadcrumb()}
              </span>
            </Show>
            <span class="editor-file-name" title={editorStore.state.openFilePath ?? ''}>
              <span class="editor-file-label">{getFileName()}</span>
              <Show
                when={
                  editorStore.state.isDirty ||
                  editorStore.state.isSaving ||
                  editorStore.state.error ||
                  editorStore.state.conflictKind
                }
              >
                <span
                  class="editor-unsaved-dot"
                  classList={{
                    'needs-attention': Boolean(
                      editorStore.state.error || editorStore.state.conflictKind
                    ),
                  }}
                  role="status"
                  aria-label={saveLabel()}
                  title={saveLabel()}
                />
              </Show>
            </span>
          </div>
          <Show when={editorStore.state.isReadOnly}>
            <span class="badge badge-readonly">Read only</span>
          </Show>
        </div>
      </div>
      <div class="editor-actions">
        <Show
          when={
            editorStore.state.fileKind === 'text-source' &&
            !editorStore.state.isReadOnly &&
            canFormatDocument(editorStore.state.openFilePath ?? '')
          }
        >
          <button
            type="button"
            class="editor-template-btn"
            aria-label="Format document"
            disabled={formatting()}
            onClick={() => void formatDocument()}
          >
            {formatting() ? 'Formatting…' : 'Format'}
          </button>
        </Show>
        <Show when={editorStore.state.fileKind === 'markdown'}>
          <button
            class="editor-reference-toggle"
            type="button"
            aria-label="Outline and backlinks"
            title="Outline and backlinks"
            aria-expanded={uiStore.state.isReferencePanelOpen}
            onClick={() => uiStore.toggleReferencePanel()}
          >
            <Icon name="list" size={17} />
          </button>
        </Show>
      </div>
      <Show when={message()}>
        <span class="editor-copy-toast" role="status">
          {message()}
        </span>
      </Show>
    </div>
  );
}
