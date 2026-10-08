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
        <Icon name="virtual-folder" size={32} />
      </div>
      <span class="workspace-eyebrow">A place for your ideas</span>
      <h1 id="empty-workspace-title">Welcome to Collectives</h1>
      <p>
        Start a collection for your notes, or bring in the Markdown files you already use.
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
      <span class="empty-workspace-footnote">Your notes stay in local files that you own.</span>
    </section>
  );
}
