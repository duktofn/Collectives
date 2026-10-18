interface SettingsNumberInputProps {
  id: string;
  label: string;
  value: number;
  defaultValue: number;
  min: number;
  step: number;
  onChange: (value: number) => void;
}

export function SettingsNumberInput(props: SettingsNumberInputProps) {
  const adjust = (direction: number) => {
    const current = Number.isFinite(props.value) ? props.value : props.defaultValue;
    props.onChange(Math.max(props.min, Number((current + direction * props.step).toFixed(10))));
  };

  return (
    <div class="input-group">
      <label for={props.id}>{props.label}</label>
      <div class="settings-number-input">
        <input
          id={props.id}
          type="number"
          min={props.min}
          step={props.step}
          value={props.value}
          onInput={(event) => props.onChange(event.currentTarget.valueAsNumber)}
        />
        <div class="settings-number-actions">
          <button
            type="button"
            aria-label={`Decrease ${props.label.toLowerCase()}`}
            aria-controls={props.id}
            disabled={Number.isFinite(props.value) && props.value <= props.min}
            onClick={() => adjust(-1)}
          >
            <span aria-hidden="true">−</span>
          </button>
          <button
            type="button"
            aria-label={`Increase ${props.label.toLowerCase()}`}
            aria-controls={props.id}
            onClick={() => adjust(1)}
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
      </div>
    </div>
  );
}
