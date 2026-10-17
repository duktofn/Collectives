import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { getCurrentAppWindow } from '../../platform';
import { Icon } from '../common/Icon';
import './WindowFrame.css';

export function WindowFrame(props: {
  title: string;
  children: JSX.Element;
  onError: (error: unknown) => void;
}) {
  const desktop =
    typeof window !== 'undefined' &&
    Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
  const [maximized, setMaximized] = createSignal(false);
  let active = true;
  let removeResize: (() => void) | undefined;
  let stateRequest = 0;
  const refreshState = async () => {
    const request = ++stateRequest;
    const value = await getCurrentAppWindow().isMaximized();
    if (active && request === stateRequest) setMaximized(Boolean(value));
  };
  const action = async (run: () => Promise<unknown>) => {
    if (!desktop) return;
    try {
      await run();
    } catch (error) {
      props.onError(error);
    }
  };
  const toggleMaximize = () =>
    action(async () => {
      await getCurrentAppWindow().toggleMaximize();
      await refreshState();
    });
  onMount(() => {
    document.documentElement.dataset.windowFrame = 'custom';
    if (!desktop) return;
    void action(refreshState);
    void getCurrentAppWindow()
      .onResized(() => {
        void action(refreshState);
      })
      .then((unlisten) => {
        if (active) removeResize = unlisten;
        else unlisten();
      })
      .catch((error) => {
        if (active) props.onError(error);
      });
  });
  onCleanup(() => {
    active = false;
    removeResize?.();
    delete document.documentElement.dataset.windowFrame;
  });
  return (
    <div class="app-window-frame" classList={{ 'is-maximized': maximized() }}>
      <header class="window-titlebar" aria-label="Window title bar">
        <div
          class="window-drag-region"
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            if (event.detail === 2) void toggleMaximize();
            else void action(() => getCurrentAppWindow().startDragging());
          }}
        >
          <span class="window-brand-icon" aria-hidden="true">
            <Icon name="virtual-folder" size={15} />
          </span>
          <span class="window-title">{props.title}</span>
        </div>
        <div class="window-controls" aria-label="Window controls">
          <button
            type="button"
            disabled={!desktop}
            aria-label="Minimize window"
            title="Minimize"
            onClick={() => void action(() => getCurrentAppWindow().minimize())}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M1 6h10" />
            </svg>
          </button>
          <button
            type="button"
            disabled={!desktop}
            aria-label={maximized() ? 'Restore window' : 'Maximize window'}
            title={maximized() ? 'Restore' : 'Maximize'}
            onClick={() => void toggleMaximize()}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <Show when={maximized()} fallback={<rect x="1.5" y="1.5" width="9" height="9" />}>
                <path d="M4 1.5h6.5V8M1.5 4h6.5v6.5H1.5z" />
              </Show>
            </svg>
          </button>
          <button
            type="button"
            class="window-close"
            disabled={!desktop}
            aria-label="Close window"
            title="Close"
            onClick={() => void action(() => getCurrentAppWindow().close())}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="m2 2 8 8m0-8-8 8" />
            </svg>
          </button>
        </div>
      </header>
      <div class="app-window-content">{props.children}</div>
    </div>
  );
}
