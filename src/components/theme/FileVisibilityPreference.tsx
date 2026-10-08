interface FileVisibilityPreferenceProps {
  checked: boolean;
  disabled?: boolean;
  onChange: (hidden: boolean) => void;
}

export function FileVisibilityPreference(props: FileVisibilityPreferenceProps) {
  return (
    <div class="file-visibility-preference">
      <label>
        <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(event) => props.onChange(event.currentTarget.checked)} />
        Hide unsupported files
      </label>
      <span>When off, unsupported files stay visible but cannot be opened.</span>
    </div>
  );
}
