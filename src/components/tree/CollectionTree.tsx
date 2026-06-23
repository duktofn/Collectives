import { createSignal, For, Show } from "solid-js";
import { Collection } from "../../types";
import { collectionsStore } from "../../stores/collections";
import { TreeNode } from "./TreeNode";
import { Icon } from "../common/Icon";
import { Dialog } from "../common/Dialog";
import { pickFiles, pickDirectory } from "../../lib/tauri";
import "./Tree.css";

interface CollectionTreeProps {
  collection: Collection;
}

export function CollectionTree(props: CollectionTreeProps) {
  const [isNewGroupOpen, setIsNewGroupOpen] = createSignal(false);
  const [newGroupError, setNewGroupError] = createSignal("");

  const handleAddFiles = async () => {
    try {
      const selected = await pickFiles("Select Markdown Notes");
      if (selected && selected.length > 0) {
        await collectionsStore.addFiles(selected);
      }
    } catch (err) {
      console.error("Failed to pick files", err);
    }
  };

  const handleAddFolderRef = async () => {
    try {
      const selected = await pickDirectory("Select Folder to Reference");
      if (selected) {
        await collectionsStore.addFolderRef(selected);
      }
    } catch (err) {
      console.error("Failed to pick directory", err);
    }
  };

  const handleCreateRootGroup = async (name?: string) => {
    if (!name) {
      setNewGroupError("Group name cannot be empty");
      return;
    }
    await collectionsStore.createGroup(name, []);
    setIsNewGroupOpen(false);
    setNewGroupError("");
  };

  return (
    <div class="collection-tree-panel">
      <div class="tree-header">
        <h3 class="tree-title" title={props.collection.name}>
          {props.collection.name}
        </h3>
        <div class="tree-header-actions">
          <button
            class="btn btn-text"
            onClick={handleAddFiles}
            title="Add Markdown files"
            style={{ padding: "4px" }}
          >
            <Icon name="file-plus" size={16} />
          </button>
          <button
            class="btn btn-text"
            onClick={handleAddFolderRef}
            title="Add Folder reference"
            style={{ padding: "4px" }}
          >
            <Icon name="folder-plus" size={16} />
          </button>
          <button
            class="btn btn-text"
            onClick={() => {
              setNewGroupError("");
              setIsNewGroupOpen(true);
            }}
            title="Create virtual group"
            style={{ padding: "4px" }}
          >
            <Icon name="plus" size={16} />
          </button>
        </div>
      </div>

      <div class="tree-content">
        <Show
          when={props.collection.entries.length > 0}
          fallback={
            <div style={{
              padding: "32px 16px",
              color: "var(--color-text-muted)",
              "font-size": "13px",
              "text-align": "center",
              "line-height": "1.6"
            }}>
              No entries in this collection.<br />
              Use the toolbar buttons above to add files, folders, or groups.
            </div>
          }
        >
          <For each={props.collection.entries}>
            {(entry, idx) => (
              <TreeNode
                entry={entry}
                depth={0}
                parentPath={[]}
                index={idx()}
              />
            )}
          </For>
        </Show>
      </div>

      <Dialog
        isOpen={isNewGroupOpen()}
        title="Create Group"
        type="input"
        placeholder="Group name"
        errorMessage={newGroupError()}
        onConfirm={handleCreateRootGroup}
        onClose={() => setIsNewGroupOpen(false)}
      />
    </div>
  );
}
