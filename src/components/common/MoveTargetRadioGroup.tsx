import { For } from "solid-js";

export interface MoveTargetOption {
  id: string;
  name: string;
  path: number[];
}

interface MoveTargetRadioGroupProps {
  name: string;
  options: MoveTargetOption[];
  selectedId: string;
  onChange: (id: string) => void;
  onConfirm: () => void;
}

export function MoveTargetRadioGroup(props: MoveTargetRadioGroupProps) {
  return (
    <fieldset
      class="move-target-radio-group"
      aria-label="Move destination"
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          props.onConfirm();
        }
      }}
    >
      <legend>Destination</legend>
      <div class="parent-select-list" role="radiogroup" aria-label="Move destination options">
        <For each={props.options}>{(option) => (
          <label class="parent-select-item" classList={{ selected: props.selectedId === option.id }}>
            <input
              type="radio"
              name={props.name}
              value={option.id}
              checked={props.selectedId === option.id}
              onChange={() => props.onChange(option.id)}
            />
            <span>{option.name}</span>
          </label>
        )}</For>
      </div>
    </fieldset>
  );
}
