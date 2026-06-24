import { createSignal, Show, For, onMount, onCleanup } from "solid-js";
import { Entry, FsEntry } from "../../types";
import { collectionsStore } from "../../stores/collections";
import { uiStore } from "../../stores/ui";
import { Icon } from "../common/Icon";
import { ContextMenu, ContextMenuItem } from "../common/ContextMenu";
import { Dialog } from "../common/Dialog";
import { message } from "@tauri-apps/plugin-dialog";
import { readFolderChildren, pickDirectory, watchFolder, unwatchFolder } from "../../lib/tauri";
import { listen } from "@tauri-apps/api/event";
import "./Tree.css";

interface FolderRefNodeProps {
  entry: Extract<Entry, { type: "folder-ref" }>;
  depth: number;
  parentPath: number[];
  index: number;
}

export function FolderRefNode(props: FolderRefNodeProps) {
  const entry = () => props.entry;
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

    const unlistenPromise = listen<{ path: string }>("folder-changed", (event) => {
      if (event.payload.path === entry().path && isExpanded() && !isBroken()) {
        reloadChildren();
      }
    });

    onCleanup(() => {
      unlistenPromise.then((unlisten) => unlisten());
      if (isExpanded() && !isBroken()) {
        unwatchFolder(entry().path).catch((err) => {
          console.error("Failed to unwatch folder on cleanup", entry().path, err);
        });
      }
    });
  });

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setIsContextMenuOpen(true);
  };

  const handleRemove = async () => {
    try {
      await collectionsStore.removeEntry(entry().id);
      if (uiStore.isSelected(entry().id)) {
        uiStore.selectEntry(null);
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
        onClick={toggleExpand}
        onContextMenu={handleContextMenu}
        title={entry().path}
      >
        <div
          class="tree-node-arrow"
          style={{
            transform: isExpanded() ? "rotate(90deg)" : "none",
            opacity: isBroken() ? 0.3 : 1
          }}
        >
          <Icon name="chevron-right" size={12} />
        </div>
        <div class="tree-node-icon">
          <Show when={isBroken()} fallback={<Icon name="folder" size={14} />}>
            <Icon name="warning" size={14} />
          </Show>
        </div>
        <span class="tree-node-name">{getFolderName(entry().path)}</span>
        <Show when={loading()}>
          <div class="tree-node-loading-spinner" />
        </Show>
      </div>

      <Show when={isExpanded() && !isBroken() && children().length > 0}>
        <For each={children()}>
          {(child) => (
            <FsNode item={child} depth={props.depth + 1} />
          )}
        </For>
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
        <div class="parent-select-list">
          <For each={getGroups()}>
            {(group) => (
              <div
                class="parent-select-item"
                classList={{ selected: selectedParentId() === group.id }}
                onClick={() => setSelectedParentId(group.id)}
              >
                {group.name}
              </div>
            )}
          </For>
        </div>
      </Dialog>
    </div>
  );
}

// Internal recursive FsNode component for displaying files and directories on disk
interface FsNodeProps {
  item: FsEntry;
  depth: number;
}

function FsNode(props: FsNodeProps) {
  const [children, setChildren] = createSignal<FsEntry[]>([]);
  const [isExpanded, setIsExpanded] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [broken, setBroken] = createSignal(false);

  const getDisplayName = () => {
    if (!props.item.isDir && props.item.name.endsWith(".md")) {
      return props.item.name.slice(0, -3);
    }
    return props.item.name;
  };

  const isSelected = () => uiStore.isSelected(props.item.path);

  const handleClick = async (e: MouseEvent) => {
    e.stopPropagation();
    if (props.item.isDir) {
      if (broken()) return;
      const nextExpanded = !isExpanded();
      setIsExpanded(nextExpanded);
      
      if (nextExpanded) {
        setLoading(true);
        try {
          const contents = await readFolderChildren(props.item.path);
          setChildren(contents);
          setBroken(false);
        } catch (err) {
          console.error("Failed to read subdirectory children", err);
          setBroken(true);
        } finally {
          setLoading(false);
        }
      }
    } else {
      uiStore.selectEntry(props.item.path);
    }
  };

  return (
    <div class="tree-node-wrapper">
      <div
        class="tree-node"
        classList={{
          selected: !props.item.isDir && isSelected(),
          broken: broken(),
        }}
        style={{ "padding-left": `${props.depth * 16 + 8}px` }}
        onClick={handleClick}
        title={props.item.path}
      >
        <Show
          when={props.item.isDir}
          fallback={
            <div style={{ width: "18px", height: "18px", "flex-shrink": 0 }} />
          }
        >
          <div
            class="tree-node-arrow"
            style={{
              transform: isExpanded() ? "rotate(90deg)" : "none",
              opacity: broken() ? 0.3 : 1
            }}
          >
            <Icon name="chevron-right" size={12} />
          </div>
        </Show>
        
        <div class="tree-node-icon">
          <Show when={broken()} fallback={<Icon name={props.item.isDir ? "folder" : "file"} size={14} />}>
            <Icon name="warning" size={14} />
          </Show>
        </div>
        
        <span class="tree-node-name">{getDisplayName()}</span>
        <Show when={loading()}>
          <div class="tree-node-loading-spinner" />
        </Show>
      </div>

      <Show when={props.item.isDir && isExpanded() && !broken() && children().length > 0}>
        <For each={children()}>
          {(child) => (
            <FsNode item={child} depth={props.depth + 1} />
          )}
        </For>
      </Show>
    </div>
  );
}
