import { createSignal, Show, For, onMount, onCleanup } from "solid-js";
import { Entry, FsEntry } from "../../types";
import { collectionsStore } from "../../stores/collections";
import { uiStore } from "../../stores/ui";
import { editorStore } from "../../stores/editor";
import { Icon } from "../common/Icon";
import { ContextMenu, ContextMenuItem } from "../common/ContextMenu";
import { Dialog } from "../common/Dialog";
import { message, pickDirectory } from "../../platform";
import { readFolderChildren, watchFolder, unwatchFolder } from "../../features/filesystem";
import { listenEvent } from "../../shared/ipc/events";
import { createFolderRefFeedSubscription } from "../../features/filesystem/folderRefFeed";
import { cancelFolderRefReadiness, retryFolderRefChildFromEvent } from "../../features/filesystem/folderRefReadiness";
import { FolderRefChildRow } from "./FolderRefChildRow";
import { treeItemIdentity } from "./treeAccessibility";
import { MoveTargetRadioGroup } from "../common/MoveTargetRadioGroup";
import "./Tree.css";

interface FolderRefNodeProps {
  entry: Extract<Entry, { type: "folder-ref" }>;
  depth: number;
  parentPath: number[];
  index: number;
  parentTreeId?: string;
  requestFolderRefSelect: (intent: import("../../features/filesystem/folderRefReadiness").FolderRefIntentInput) => Promise<boolean>;
}
export function FolderRefNode(props: FolderRefNodeProps) {
  const entry = () => props.entry;
  const treeId = () => treeItemIdentity(["entry", entry().id]);
  const [contextMenuPos, setContextMenuPos] = createSignal({ x: 0, y: 0 });
  const [isContextMenuOpen, setIsContextMenuOpen] = createSignal(false);
  const [isMoveOpen, setIsMoveOpen] = createSignal(false);
  const [selectedParentId, setSelectedParentId] = createSignal<string>("root");

  const [children, setChildren] = createSignal<FsEntry[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [localBroken, setLocalBroken] = createSignal(false);

  const getFolderName = (path: string) => {
    const cleanPath = path.replace(/\\/g, "/");
    const parts = cleanPath.split("/");
    return parts[parts.length - 1] || path;
  };

  const isExpanded = () => uiStore.isExpanded(entry().id);
  const isBroken = () => localBroken() || collectionsStore.state.brokenEntries.some((b) => b.id === entry().id);

  const reloadChildren = async () => {
    setLoading(true);
    try {
      const contents = await readFolderChildren(entry().path);
      setChildren(contents);
      setLocalBroken(false);
    } catch (err) {
      console.error("Failed to reload folder children", err);
      setLocalBroken(true);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = async (e: MouseEvent) => {
    e.stopPropagation();
    if (isBroken()) return;

    const nextExpanded = !isExpanded();
    uiStore.toggleExpand(entry().id);

    if (nextExpanded) {
      try {
        await watchFolder(entry().path, entry().id);
      } catch (err) {
        console.error("Failed to watch folder", entry().path, err);
      }
      await reloadChildren();
    } else {
      try {
        await unwatchFolder(entry().path);
      } catch (err) {
        console.error("Failed to unwatch folder", entry().path, err);
      }
    }
  };

  onMount(() => {
    if (typeof window === "undefined" || (window as any).__TAURI_INTERNALS__ === undefined) {
      return;
    }
    if (isExpanded() && !isBroken()) {
      watchFolder(entry().path, entry().id).catch((err) => {
        console.error("Failed to watch folder on mount", entry().path, err);
      });
      reloadChildren();
    }

    const unlistenPromise = listenEvent("folder-changed", (event) => {
      if (event.payload.path === entry().path && isExpanded() && !isBroken()) {
        reloadChildren();
      }
    });
    const feedSubscription = createFolderRefFeedSubscription(reloadChildren);
    const unlistenV2Promise = listenEvent("filesystem-changes-v2", (event) => {
      for (const change of event.payload.changes) feedSubscription.handle(change, entry().path, entry().id, isExpanded(), isBroken());
      retryFolderRefChildFromEvent(event.payload, entry().path, entry().id);
    });

    onCleanup(() => {
      unlistenPromise.then((unlisten) => unlisten());
      unlistenV2Promise.then((unlisten) => unlisten());
      feedSubscription.dispose();
      if (isExpanded() && !isBroken()) {
        unwatchFolder(entry().path).catch((err) => {
          console.error("Failed to unwatch folder on cleanup", entry().path, err);
        });
      }
      cancelFolderRefReadiness(entry().id);
    });
  });

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).focus();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setIsContextMenuOpen(true);
  };

  const handleRemove = async () => {
    try {
      if (uiStore.isSelected(entry().id) && !(await editorStore.closeFile())) return;
      await collectionsStore.removeEntry(entry().id);
      if (uiStore.isSelected(entry().id)) {
        await editorStore.selectEntry(null);
      }
    } catch (err) {
      await message(err instanceof Error ? err.message : String(err), {
        title: "Remove Folder Failed",
        kind: "error",
      });
    }
  };

  const handleRelink = async () => {
    try {
      const selected = await pickDirectory("Relink Folder: " + getFolderName(entry().path));
      if (selected) {
        await collectionsStore.relinkEntry(entry().id, selected);
      }
    } catch (err) {
      console.error("Failed to relink folder", err);
    }
  };

  const getGroups = () => {
    const activeCol = collectionsStore.activeCollection();
    if (!activeCol) return [];
    
    interface GroupOption {
      id: string;
      name: string;
      path: number[];
    }
    
    const options: GroupOption[] = [{ id: "root", name: "Collection Root (Top Level)", path: [] }];
    
    const recurse = (entries: Entry[], currentPath: number[]) => {
      entries.forEach((ent, idx) => {
        if (ent.type === "group") {
          const path = [...currentPath, idx];
          options.push({
            id: ent.id,
            name: "  ".repeat(path.length) + ent.name,
            path
          });
          recurse(ent.children, path);
        }
      });
    };
    
    recurse(activeCol.entries, []);
    return options;
  };

  const handleMoveConfirm = async () => {
    const options = getGroups();
    const selectedOpt = options.find((o) => o.id === selectedParentId());
    if (selectedOpt) {
      try {
        await collectionsStore.moveEntry(entry().id, selectedOpt.path, 0);
        setIsMoveOpen(false);
      } catch (err) {
        await message(err instanceof Error ? err.message : String(err), {
          title: "Move Folder Failed",
          kind: "error",
        });
      }
    } else {
      setIsMoveOpen(false);
    }
  };

  const contextMenuItems = () => {
    const items: ContextMenuItem[] = [];
    if (isBroken()) {
      items.push({
        label: "Relink...",
        icon: "edit",
        onClick: handleRelink,
      });
    }
    items.push(
      {
        label: "Move to...",
        icon: "chevron-right",
        onClick: () => {
          setSelectedParentId("root");
          setIsMoveOpen(true);
        },
      },
      {
        label: "Remove from Collection",
        icon: "trash",
        danger: true,
        onClick: handleRemove,
        separatorBefore: isBroken(),
      }
    );
    return items;
  };

  return (
    <div class="tree-node-wrapper">
      <div
        class="tree-node"
        classList={{ broken: isBroken() }}
        style={{ "padding-left": `${props.depth * 16 + 8}px` }}
        role="treeitem"
        tabIndex={-1}
        aria-level={props.depth + 1}
        aria-selected="false"
        aria-expanded={isExpanded() ? "true" : "false"}
        aria-busy={loading() ? "true" : undefined}
        data-tree-item-id={treeId()}
        data-tree-parent-id={props.parentTreeId}
        data-tree-label={getFolderName(entry().path)}
        onClick={toggleExpand}
        onContextMenu={handleContextMenu}
        title={entry().path}
      >
        <div class="tree-node-icon">
          <Show when={isBroken()} fallback={<Icon name="folder" size={14} />}>
            <Icon name="warning" size={14} />
          </Show>
        </div>
        <span class="tree-node-name">{getFolderName(entry().path)}</span>
        <Show when={loading()}>
          <div class="tree-node-loading-spinner" />
        </Show>
        <div
          class="tree-node-arrow"
          style={{
            transform: isExpanded() ? "rotate(90deg)" : "none",
            opacity: isBroken() ? 0.3 : 1
          }}
        >
          <Icon name="chevron-right" size={12} />
        </div>
      </div>

      <Show when={isExpanded() && !isBroken() && children().length > 0}>
        <div role="group">
          <For each={children()}>
            {(child) => (
              <FolderRefChildRow
                item={child}
                depth={props.depth + 1}
                parentTreeId={treeId()}
                collectionId={collectionsStore.state.activeCollectionId ?? ""}
                folderRefEntryId={entry().id}
                rootPath={entry().path}
                requestSelect={props.requestFolderRefSelect}
              />
            )}
          </For>
        </div>
      </Show>

      <ContextMenu
        x={contextMenuPos().x}
        y={contextMenuPos().y}
        isOpen={isContextMenuOpen()}
        items={contextMenuItems()}
        onClose={() => setIsContextMenuOpen(false)}
      />

      <Dialog
        isOpen={isMoveOpen()}
        title="Move Folder Reference"
        type="confirm"
        onConfirm={handleMoveConfirm}
        onClose={() => setIsMoveOpen(false)}
      >
        <p style={{ "font-size": "13px", "margin-bottom": "8px" }}>
          Select target destination for <strong>{getFolderName(entry().path)}</strong>:
        </p>
        <MoveTargetRadioGroup
          name={`folder-ref-move-${entry().id}`}
          options={getGroups()}
          selectedId={selectedParentId()}
          onChange={setSelectedParentId}
          onConfirm={() => { void handleMoveConfirm(); }}
        />
      </Dialog>
    </div>
  );
}
