import { JSX, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { createModalFocusController } from "./ModalFocusScope";
import "./ModalLayer.css";

interface ModalLayerProps {
  isOpen: boolean;
  labelledBy: string;
  describedBy?: string;
  overlayClass?: string;
  contentClass?: string;
  onClose: () => void;
  pending?: boolean;
  children: JSX.Element;
}

export function ModalLayer(props: ModalLayerProps) {
  const requestClose = () => { if (!props.pending) props.onClose(); };
  const focusController = createModalFocusController(() => props.isOpen, requestClose);

  return (
    <Show when={props.isOpen}>
      <Portal mount={document.body}>
        <div
          class={`modal-layer-overlay ${props.overlayClass ?? ""}`}
          data-modal-layer="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) requestClose();
          }}
        >
          <div
            ref={focusController.attach}
            class={`modal-layer-content ${props.contentClass ?? ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={props.labelledBy}
            aria-describedby={props.describedBy}
            tabIndex={-1}
            data-modal-focus-scope="true"
            onKeyDown={focusController.handleKeyDown}
          >
            {props.children}
          </div>
        </div>
      </Portal>
    </Show>
  );
}
