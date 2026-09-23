import { Show } from "solid-js";
import { ThemePanel } from "../components/theme/ThemePanel";
import type { Settings } from "../types";
import type { OperationLeaseRegistry } from "./operationLease";

interface SettingsWorkflowProps {
  isOpen: boolean;
  leaseRegistry: OperationLeaseRegistry;
  settings: Settings;
  onClose: () => void;
  onSettingsChange: (settings: Settings) => void;
}

export function SettingsWorkflow(props: SettingsWorkflowProps) {
  return (
    <Show when={props.isOpen}>
      <ThemePanel
        isOpen={true}
        operationLeaseRegistry={props.leaseRegistry}
        onClose={props.onClose}
        settings={props.settings}
        onSettingsChange={props.onSettingsChange}
      />
    </Show>
  );
}
