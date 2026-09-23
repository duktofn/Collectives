import { createSignal } from "solid-js";
import { Collection } from "../../types";
import { collectionsStore } from "../../stores/collections";
import { Icon } from "../common/Icon";
import { ContextMenu, ContextMenuItem } from "../common/ContextMenu";
import { Dialog } from "../common/Dialog";
import { message, pickDirectory, saveZipDialog } from "../../platform";
import type { OperationLeaseRegistry } from "../../workflows/operationLease";
import { runArchiveOperation } from "../../workflows/ArchiveWorkflow";

interface CollectionItemProps {
  collection: Collection;
  requestSwitch: (collectionId: string) => Promise<boolean>;
  operationLeaseRegistry?: OperationLeaseRegistry;
}

export function deriveCollectionExportTarget(parent: string, name: string): string {
  const sanitized = name.replace(/[<>:"/\\|?*]/g, "_").trim().replace(/[. ]+$/g, "") || "Collection";
  return `${parent.replace(/[\\/]+$/, "")}/${sanitized}`;
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
    (e.currentTarget as HTMLElement).focus();
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
    try {
      await collectionsStore.deleteCollection(props.collection.id);
      setIsDeleteOpen(false);
    } catch (err) {
      await message(err instanceof Error ? err.message : String(err), {
        title: "Delete Collection Failed",
        kind: "error",
      });
    }
  };

  const handleExportToFolder = async () => {
    try {
      const destPath = await pickDirectory(`Export "${props.collection.name}" to Folder`);
      if (destPath) {
        const operation = () => collectionsStore.exportCollectionToFolder(props.collection.id, deriveCollectionExportTarget(destPath, props.collection.name));
        if (props.operationLeaseRegistry) await runArchiveOperation(props.operationLeaseRegistry, "Export collection folder", operation);
        else await operation();
      }
    } catch (err) {
      console.error("Failed to export folder", err);
    }
  };

  const handleExportToZip = async () => {
    try {
      const destZipPath = await saveZipDialog(`Export "${props.collection.name}" as ZIP`);
      if (destZipPath) {
        const operation = () => collectionsStore.exportCollectionToZip(props.collection.id, destZipPath);
        if (props.operationLeaseRegistry) await runArchiveOperation(props.operationLeaseRegistry, "Export collection ZIP", operation);
        else await operation();
      }
    } catch (err) {
      console.error("Failed to export zip", err);
    }
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
      label: "Export to Folder",
      icon: "folder",
      onClick: handleExportToFolder,
    },
    {
      label: "Export as ZIP",
      icon: "file",
      onClick: handleExportToZip,
    },
    {
      label: "Delete",
      icon: "trash",
      danger: true,
      onClick: () => setIsDeleteOpen(true),
      separatorBefore: true,
    },
  ];

  return (
    <>
      <div
        class="collection-item"
        classList={{ active: isActive() }}
        role="button"
        tabIndex={0}
        aria-label={`Collection ${props.collection.name}`}
        aria-pressed={isActive() ? "true" : "false"}
        onClick={() => { void props.requestSwitch(props.collection.id); }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void props.requestSwitch(props.collection.id);
          }
        }}
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
