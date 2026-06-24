import { createSignal, Show, For } from "solid-js";
import { Entry } from "../../types";
import { collectionsStore } from "../../stores/collections";
import { uiStore } from "../../stores/ui";
import { Icon } from "../common/Icon";
import { ContextMenu, ContextMenuItem } from "../common/ContextMenu";
import { Dialog } from "../common/Dialog";
import { message } from "@tauri-apps/plugin-dialog";
import { pickFiles } from "../../lib/tauri";
import "./Tree.css";

interface FileNodeProps {
  entry: Extract<Entry, { type: "file" }>;
  depth: number;
  parentPath: number[];
  index: number;
}

export function FileNode(props: FileNodeProps) {
  const [contextMenuPos, setContextMenuPos] = createSignal({ x: 0, y: 0 });
  const [isContextMenuOpen, setIsContextMenuOpen] = createSignal(false);
  const [isMoveOpen, setIsMoveOpen] = createSignal(false);
  const [selectedParentId, setSelectedParentId] = createSignal<string>("root");

  const getFileName = (path: string) => {
    const cleanPath = path.replace(/\\/g, "/");
    const parts = cleanPath.split("/");
    const last = parts[parts.length - 1] || "";
    return last.endsWith(".md") ? last.slice(0, -3) : last;
  };

  const isSelected = () => uiStore.isSelected(props.entry.id);
  const isBroken = () => collectionsStore.state.brokenEntries.some((b) => b.id === props.entry.id);

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setIsContextMenuOpen(true);
  };

  const handleRemove = async () => {
    try {
      await collectionsStore.removeEntry(props.entry.id);
      if (uiStore.isSelected(props.entry.id)) {
        uiStore.selectEntry(null);
      }
    } catch (err) {
      await message(err instanceof Error ? err.message : String(err), {
        title: "Remove File Failed",
        kind: "error",
      });
    }
  };

  const handleRelink = async () => {
    try {
      const selected = await pickFiles("Relink File: " + getFileName(props.entry.path));
      if (selected && selected[0]) {
        await collectionsStore.relinkEntry(props.entry.id, selected[0]);
      }
    } catch (err) {
      console.error("Failed to relink file", err);
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
      entries.forEach((entryItem, idx) => {
        if (entryItem.type === "group") {
          const path = [...currentPath, idx];
          options.push({
            id: entryItem.id,
            name: "  ".repeat(path.length) + entryItem.name,
            path
          });
          recurse(entryItem.children, path);
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
        await collectionsStore.moveEntry(props.entry.id, selectedOpt.path, 0);
        setIsMoveOpen(false);
      } catch (err) {
        await message(err instanceof Error ? err.message : String(err), {
          title: "Move File Failed",
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
    <>
      <div
        class="tree-node"
        classList={{ selected: isSelected(), broken: isBroken() }}
        style={{ "padding-left": `${props.depth * 16 + 8}px` }}
        onClick={() => uiStore.selectEntry(props.entry.id)}
        onContextMenu={handleContextMenu}
        title={isBroken() ? "File not found: " + props.entry.path : props.entry.path}
      >
        <div class="tree-node-icon">
          <Show when={isBroken()} fallback={<Icon name="file" size={14} />}>
            <Icon name="warning" size={14} />
          </Show>
        </div>
        <span class="tree-node-name">{getFileName(props.entry.path)}</span>
      </div>

      <ContextMenu
        x={contextMenuPos().x}
        y={contextMenuPos().y}
        isOpen={isContextMenuOpen()}
        items={contextMenuItems()}
        onClose={() => setIsContextMenuOpen(false)}
      />

      <Dialog
        isOpen={isMoveOpen()}
        title="Move File"
        type="confirm"
        onConfirm={handleMoveConfirm}
        onClose={() => setIsMoveOpen(false)}
      >
        <p style={{ "font-size": "13px", "margin-bottom": "8px" }}>
          Select target destination for <strong>{getFileName(props.entry.path)}</strong>:
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
    </>
  );
}
