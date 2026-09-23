import { JSX, Show } from "solid-js";

interface WorkspaceHeaderProps {
  isEditorOpen: boolean;
  children?: JSX.Element;
}

export function WorkspaceHeader(props: WorkspaceHeaderProps) {
  return (
    <div class="workspace-header" data-editor-open={props.isEditorOpen ? "true" : "false"}>
      <Show when={props.isEditorOpen} fallback={<div class="workspace-context-header">Workspace</div>}>
        {props.children}
      </Show>
    </div>
  );
}
