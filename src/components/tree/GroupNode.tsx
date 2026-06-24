import { createSignal, Show, For } from "solid-js";
import { Entry } from "../../types";
import { collectionsStore } from "../../stores/collections";
import { uiStore } from "../../stores/ui";
import * as api from "../../lib/tauri";
import { Icon } from "../common/Icon";
import { ContextMenu, ContextMenuItem } from "../common/ContextMenu";
import { Dialog } from "../common/Dialog";
import { TreeNode } from "./TreeNode";
import { message } from "@tauri-apps/plugin-dialog";
import "./Tree.css";

interface GroupNodeProps {
  entry: Extract<Entry, { type: "group" }>;
  depth: number;
  parentPath: number[];
  index: number;
}

export function GroupNode(props: GroupNodeProps) {
  const entry = () => props.entry;
  const myPath = () => [...props.parentPath, props.index];

  const [contextMenuPos, setContextMenuPos] = createSignal({ x: 0, y: 0 });
  const [isContextMenuOpen, setIsContextMenuOpen] = createSignal(false);
  
  const [isNewGroupOpen, setIsNewGroupOpen] = createSignal(false);
  const [isRenameOpen, setIsRenameOpen] = createSignal(false);
  const [isDeleteOpen, setIsDeleteOpen] = createSignal(false);
  const [isMoveOpen, setIsMoveOpen] = createSignal(false);
  
  const [selectedParentId, setSelectedParentId] = createSignal<string>("root");
  const [renameError, setRenameError] = createSignal("");
  const [newGroupError, setNewGroupError] = createSignal("");

  const isExpanded = () => uiStore.isExpanded(entry().id);

  const toggleExpand = (e: MouseEvent) => {
    e.stopPropagation();
    uiStore.toggleExpand(entry().id);
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setIsContextMenuOpen(true);
  };

  const handleCreateSubGroup = async (name?: string) => {
    if (!name) {
      setNewGroupError("Group name cannot be empty");
      return;
    }
    // We add inside this group, so parentPath for the new group is our full path!
    await collectionsStore.createGroup(name, myPath());
    setIsNewGroupOpen(false);
    setNewGroupError("");
    uiStore.setExpanded(entry().id, true); // auto expand
  };

  const handleRenameGroup = async (newName?: string) => {
    if (!newName) {
      setRenameError("Name cannot be empty");
      return;
    }
    try {
      await collectionsStore.renameGroup(entry().id, newName);
      setIsRenameOpen(false);
      setRenameError("");
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteGroup = async () => {
    try {
      // Promote all children to our parent path
      const childrenToMove = [...entry().children];
      const activeId = collectionsStore.state.activeCollectionId;
      if (activeId) {
        for (const child of childrenToMove) {
          try {
            await api.moveEntry(activeId, child.id, props.parentPath, 0);
          } catch (err) {
            console.error(`Failed to move child ${child.id} during group deletion:`, err);
          }
        }
      }
      // Delete this group
      await collectionsStore.removeEntry(entry().id);
      setIsDeleteOpen(false);
    } catch (err) {
      await message(err instanceof Error ? err.message : String(err), {
        title: "Delete Group Failed",
        kind: "error",
      });
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
          
          const isSelf = ent.id === entry().id;
          const isDescendant = path.length > myPath().length && 
            path.slice(0, myPath().length).every((v, i) => v === myPath()[i]);
            
          if (!isSelf && !isDescendant) {
            options.push({
              id: ent.id,
              name: "  ".repeat(path.length) + ent.name,
              path
            });
          }
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
      await collectionsStore.moveEntry(entry().id, selectedOpt.path, 0);
    }
    setIsMoveOpen(false);
  };

  const contextMenuItems: ContextMenuItem[] = [
    {
      label: "New Group",
      icon: "folder-plus",
      onClick: () => {
        setNewGroupError("");
        setIsNewGroupOpen(true);
      },
    },
    {
      label: "Rename",
      icon: "edit",
      onClick: () => {
        setRenameError("");
        setIsRenameOpen(true);
      },
    },
    {
      label: "Move to...",
      icon: "chevron-right",
      onClick: () => {
        setSelectedParentId("root");
        setIsMoveOpen(true);
      },
    },
    {
      label: "Delete Group (Promote children)",
      icon: "trash",
      danger: true,
      onClick: () => setIsDeleteOpen(true),
    },
  ];

  return (
    <div class="tree-node-wrapper">
      <div
        class="tree-node"
        style={{ "padding-left": `${props.depth * 16 + 8}px` }}
        onClick={toggleExpand}
        onContextMenu={handleContextMenu}
      >
        <div
          class="tree-node-arrow"
          style={{
            transform: isExpanded() ? "rotate(90deg)" : "none",
          }}
        >
          <Icon name="chevron-right" size={12} />
        </div>
        <div class="tree-node-icon">
          <Icon name="virtual-folder" size={14} style={{ color: "var(--color-accent)" }} />
        </div>
        <span class="tree-node-name">{entry().name}</span>
      </div>

      <Show when={isExpanded() && entry().children.length > 0}>
        <For each={entry().children}>
          {(child, idx) => (
            <TreeNode
              entry={child}
              depth={props.depth + 1}
              parentPath={myPath()}
              index={idx()}
            />
          )}
        </For>
      </Show>

      <ContextMenu
        x={contextMenuPos().x}
        y={contextMenuPos().y}
        isOpen={isContextMenuOpen()}
        items={contextMenuItems}
        onClose={() => setIsContextMenuOpen(false)}
      />

      <Dialog
        isOpen={isNewGroupOpen()}
        title="New Group"
        type="input"
        placeholder="Group name"
        errorMessage={newGroupError()}
        onConfirm={handleCreateSubGroup}
        onClose={() => setIsNewGroupOpen(false)}
      />

      <Dialog
        isOpen={isRenameOpen()}
        title="Rename Group"
        type="input"
        defaultValue={entry().name}
        placeholder="Group name"
        errorMessage={renameError()}
        onConfirm={handleRenameGroup}
        onClose={() => setIsRenameOpen(false)}
      />

      <Dialog
        isOpen={isDeleteOpen()}
        title="Delete Group"
        message={`Are you sure you want to delete the group "${entry().name}"? Any children inside will be promoted to the parent level.`}
        type="confirm"
        onConfirm={handleDeleteGroup}
        onClose={() => setIsDeleteOpen(false)}
      />

      <Dialog
        isOpen={isMoveOpen()}
        title="Move Group"
        type="confirm"
        onConfirm={handleMoveConfirm}
        onClose={() => setIsMoveOpen(false)}
      >
        <p style={{ "font-size": "13px", "margin-bottom": "8px" }}>
          Select target destination for group <strong>{entry().name}</strong>:
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
