import { Show, createSignal, createEffect, JSX } from "solid-js";
import { Icon } from "./Icon";
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
}

export function Dialog(props: DialogProps) {
  const [inputValue, setInputValue] = createSignal("");

  createEffect(() => {
    if (props.isOpen) {
      setInputValue(props.defaultValue ?? "");
    }
  });

  const handleConfirm = () => {
    if (props.type === "input") {
      props.onConfirm(inputValue().trim());
    } else {
      props.onConfirm();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      handleConfirm();
    } else if (e.key === "Escape") {
      props.onClose();
    }
  };

  return (
    <Show when={props.isOpen}>
      <div class="dialog-overlay" onClick={() => props.onClose()}>
        <div class="dialog-container" onClick={(e) => e.stopPropagation()}>
          <div class="dialog-header">
            <span class="dialog-title">{props.title}</span>
            <button class="dialog-close" onClick={() => props.onClose()}>
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
                ref={(el) => setTimeout(() => el?.focus(), 50)}
              />
            </Show>
            
            <Show when={props.errorMessage}>
              <div class="dialog-error">{props.errorMessage}</div>
            </Show>

            <Show when={props.children}>
              <div style={{ "margin-top": "12px" }}>{props.children}</div>
            </Show>
          </div>
          
          <div class="dialog-footer">
            <button class="btn btn-text" onClick={() => props.onClose()}>
              Cancel
            </button>
            <button class="btn btn-primary" onClick={handleConfirm}>
              Confirm
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
