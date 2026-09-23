import { Show, createSignal, createEffect, createUniqueId, JSX } from "solid-js";
import { Icon } from "./Icon";
import { ModalLayer } from "./ModalLayer";
import { announcementKey, announcer } from "../../a11y/announcer";
import "./Common.css";

interface DialogProps {
  isOpen: boolean;
  title: string;
  message?: string;
  type: "confirm" | "input";
  defaultValue?: string;
  placeholder?: string;
  onConfirm: (value?: string) => void | Promise<void>;
  onClose: () => void;
  errorMessage?: string;
  children?: JSX.Element;
  pending?: boolean;
}

export function Dialog(props: DialogProps) {
  const [inputValue, setInputValue] = createSignal("");
  const titleId = `dialog-title-${createUniqueId()}`;
  const errorId = `dialog-error-${createUniqueId()}`;

  createEffect(() => {
    if (props.isOpen) {
      setInputValue(props.defaultValue ?? "");
    }
  });

  createEffect(() => {
    const error = props.errorMessage;
    if (props.isOpen && error) announcer.alert(error, announcementKey("urgent-error", "", error));
  });

  const handleConfirm = () => {
    if (props.pending) return;
    if (props.type === "input") {
      props.onConfirm(inputValue().trim());
    } else {
      props.onConfirm();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (props.pending) return;
    if (e.key === "Enter") {
      handleConfirm();
    } else if (e.key === "Escape") {
      props.onClose();
    }
  };

  return (
    <ModalLayer
      pending={props.pending}
      isOpen={props.isOpen}
      labelledBy={titleId}
      describedBy={props.errorMessage ? errorId : undefined}
      overlayClass="dialog-overlay"
      contentClass="dialog-container"
      onClose={props.onClose}
    >
      <div class="dialog-header">
        <span class="dialog-title" id={titleId}>{props.title}</span>
        <button class="dialog-close" aria-label="Close dialog" disabled={props.pending} onClick={() => props.onClose()}>
          <Icon name="close" size={16} />
        </button>
      </div>

      <div class="dialog-body">
        <Show when={props.message}>
          <p>{props.message}</p>
        </Show>

        <Show when={props.type === "input"}>
          <input
            type="text"
            class="dialog-input"
            value={inputValue()}
            onInput={(e) => setInputValue(e.currentTarget.value)}
            placeholder={props.placeholder}
            onKeyDown={handleKeyDown}
            data-modal-initial-focus="true"
          />
        </Show>

        <Show when={props.errorMessage}>
          <div class="dialog-error" id={errorId}>{props.errorMessage}</div>
        </Show>

        <Show when={props.children}>
          <div class="dialog-extra-content">{props.children}</div>
        </Show>
      </div>

      <div class="dialog-footer">
        <button class="btn btn-text" disabled={props.pending} onClick={() => props.onClose()}>
          Cancel
        </button>
        <button class="btn btn-primary" disabled={props.pending} aria-busy={props.pending ? "true" : "false"} onClick={handleConfirm}>
          Confirm
        </button>
      </div>
    </ModalLayer>
  );
}
