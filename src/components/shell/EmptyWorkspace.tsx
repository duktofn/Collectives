import { Icon } from "../common/Icon";

interface EmptyWorkspaceProps {
  onNewCollection: () => void;
  onImportFolder: () => void;
  onImportZip: () => void;
}

export function EmptyWorkspace(props: EmptyWorkspaceProps) {
  return (
    <section class="empty-workspace" aria-labelledby="empty-workspace-title">
      <div class="empty-workspace-icon" aria-hidden="true">
        <Icon name="folder" size={46} />
      </div>
      <h1 id="empty-workspace-title">Welcome to Collections</h1>
      <p>
        Create a fresh workspace or bring in an existing Markdown folder. Your notes stay local and editable on disk.
      </p>
      <div class="empty-workspace-actions">
        <button class="btn btn-primary ds-button" data-variant="primary" onClick={props.onNewCollection}>
          <Icon name="plus" size={16} />
          New Collection
        </button>
        <button class="btn ds-button" onClick={props.onImportFolder}>
          <Icon name="folder-plus" size={16} />
          Import Folder
        </button>
        <button class="btn ds-button" onClick={props.onImportZip}>
          <Icon name="file" size={16} />
          Import ZIP
        </button>
      </div>
    </section>
  );
}
