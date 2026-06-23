import { createSignal } from "solid-js";
import { Collection } from "../../types";
import { collectionsStore } from "../../stores/collections";
import { Icon } from "../common/Icon";
import { ContextMenu, ContextMenuItem } from "../common/ContextMenu";
import { Dialog } from "../common/Dialog";

interface CollectionItemProps {
  collection: Collection;
}

export function CollectionItem(props: CollectionItemProps) {
  const [contextMenuPos, setContextMenuPos] = createSignal({ x: 0, y: 0 });
  const [isContextMenuOpen, setIsContextMenuOpen] = createSignal(false);
  const [isRenameOpen, setIsRenameOpen] = createSignal(false);
  const [isDeleteOpen, setIsDeleteOpen] = createSignal(false);
  const [renameError, setRenameError] = createSignal("");

  const isActive = () => collectionsStore.state.activeCollectionId === props.collection.id;

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setIsContextMenuOpen(true);
  };

  const handleRename = async (newName?: string) => {
    if (!newName) {
      setRenameError("Name cannot be empty");
      return;
    }
    try {
      await collectionsStore.renameCollection(props.collection.id, newName);
      setIsRenameOpen(false);
      setRenameError("");
    } catch (err: unknown) {
      setRenameError((err as Error).message || "Failed to rename");
    }
  };

  const handleDelete = async () => {
    await collectionsStore.deleteCollection(props.collection.id);
    setIsDeleteOpen(false);
  };

  const contextMenuItems: ContextMenuItem[] = [
    {
      label: "Rename",
      icon: "edit",
      onClick: () => {
        setRenameError("");
        setIsRenameOpen(true);
      },
    },
    {
      label: "Delete",
      icon: "trash",
      danger: true,
      onClick: () => setIsDeleteOpen(true),
    },
  ];

  return (
    <>
      <div
        class="collection-item"
        classList={{ active: isActive() }}
        onClick={() => collectionsStore.openCollection(props.collection.id)}
        onContextMenu={handleContextMenu}
      >
        <div class="collection-item-left">
          <Icon name="folder" size={15} style={{ opacity: isActive() ? 1 : 0.7 }} />
          <span class="collection-item-name">{props.collection.name}</span>
        </div>
        <span class="collection-item-count">
          {props.collection.entries.length}
        </span>
      </div>

      <ContextMenu
        x={contextMenuPos().x}
        y={contextMenuPos().y}
        isOpen={isContextMenuOpen()}
        items={contextMenuItems}
        onClose={() => setIsContextMenuOpen(false)}
      />

      <Dialog
        isOpen={isRenameOpen()}
        title="Rename Collection"
        type="input"
        defaultValue={props.collection.name}
        placeholder="Collection name"
        errorMessage={renameError()}
        onConfirm={handleRename}
        onClose={() => setIsRenameOpen(false)}
      />

      <Dialog
        isOpen={isDeleteOpen()}
        title="Delete Collection"
        message={`Are you sure you want to delete the collection "${props.collection.name}"? This action cannot be undone.`}
        type="confirm"
        onConfirm={handleDelete}
        onClose={() => setIsDeleteOpen(false)}
      />
    </>
  );
}
