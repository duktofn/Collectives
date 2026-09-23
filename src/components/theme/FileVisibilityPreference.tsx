import { uiStore } from "../../stores/ui";

export function FileVisibilityPreference() {
  return (
    <div class="file-visibility-preference">
      <label>
        <input type="checkbox" checked={uiStore.state.hideUnsupportedFiles} onChange={(event) => uiStore.setHideUnsupportedFiles(event.currentTarget.checked)} />
        Hide unsupported files
      </label>
      <span>When off, unsupported files stay visible but cannot be opened.</span>
    </div>
  );
}
