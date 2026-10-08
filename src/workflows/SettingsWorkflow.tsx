import { Show, createEffect, createSignal, on, onCleanup } from 'solid-js';
import { ThemePanel } from '../components/theme/ThemePanel';
import type { Settings } from '../types';
import type { OperationLeaseRegistry } from './operationLease';

interface SettingsWorkflowProps {
  isOpen: boolean;
  leaseRegistry: OperationLeaseRegistry;
  settings: Settings;
  onClose: () => void;
  onSettingsChange: (settings: Settings) => void;
}

export function SettingsWorkflow(props: SettingsWorkflowProps) {
  const [present, setPresent] = createSignal(props.isOpen);
  const [closing, setClosing] = createSignal(false);
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(
      () => props.isOpen,
      (open) => {
        clearTimeout(exitTimer);
        if (open) {
          setClosing(false);
          setPresent(true);
          return;
        }
        if (!present()) return;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
          setPresent(false);
          return;
        }
        setClosing(true);
        exitTimer = setTimeout(() => {
          setPresent(false);
          setClosing(false);
        }, 180);
      }
    )
  );
  onCleanup(() => clearTimeout(exitTimer));
  return (
    <Show when={present()}>
      <ThemePanel
        isOpen={true}
        isClosing={closing()}
        operationLeaseRegistry={props.leaseRegistry}
        onClose={props.onClose}
        settings={props.settings}
        onSettingsChange={props.onSettingsChange}
      />
    </Show>
  );
}
