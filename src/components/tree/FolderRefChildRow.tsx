import { createSignal, For, Show } from "solid-js";
import { FsEntry } from "../../types";
import { collectionsStore } from "../../stores/collections";
import { Icon } from "../common/Icon";
import { readFolderChildren } from "../../features/filesystem";
import { getFolderRefReadiness, retryFolderRefChild } from "../../features/filesystem/folderRefReadiness";
import { isMarkdownPath, isSupportedFilePath } from "../../shared/fileCapabilities.generated";
import { uiStore } from "../../stores/ui";
import { editorStore } from "../../stores/editor";
import { treeItemIdentity } from "./treeAccessibility";

interface FolderRefChildRowProps {
  item: FsEntry;
  depth: number;
  parentTreeId?: string;
  collectionId: string;
  folderRefEntryId: string;
  rootPath: string;
  requestSelect: (intent: import("../../features/filesystem/folderRefReadiness").FolderRefIntentInput) => Promise<boolean>;
}

export function isFolderRefChildOpen(path: string, selectedEntryId: string | null, openFilePath: string | null): boolean {
  return selectedEntryId === path && openFilePath === path;
}

export function FolderRefChildRow(props: FolderRefChildRowProps) {
  const [children, setChildren] = createSignal<FsEntry[]>([]);
  const [isExpanded, setIsExpanded] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [broken, setBroken] = createSignal(false);

  const readiness = () => props.item.isDir ? null : getFolderRefReadiness(props.collectionId, props.folderRefEntryId, props.item.path);
  const isSupported = () => props.item.isDir || isSupportedFilePath(props.item.path);
  const displayName = () => isMarkdownPath(props.item.path) ? props.item.name.slice(0, props.item.name.lastIndexOf(".")) : props.item.name;
  const treeId = () => treeItemIdentity(["folderref", props.folderRefEntryId, props.item.path.replace(/\\/g, "/")]);
  const isOpenSelected = () => !props.item.isDir
    && isFolderRefChildOpen(props.item.path, uiStore.state.selectedEntryId, editorStore.state.openFilePath);

  const toggleDirectory = async () => {
    if (!props.item.isDir || broken()) return;
    const next = !isExpanded();
    setIsExpanded(next);
    if (!next) return;
    setLoading(true);
    try {
      setChildren(await readFolderChildren(props.item.path));
      setBroken(false);
    } catch {
      setBroken(true);
    } finally {
      setLoading(false);
    }
  };

  const handleFileClick = async () => {
    if (!isSupported()) return;
    const current = readiness();
    if (current?.status === "broken") {
      retryFolderRefChild(current);
      return;
    }
    const cursor = collectionsStore.getFolderRefWatchCursor(props.collectionId) ?? { streamId: "", subscriptionEpoch: "", sequence: 0 };
    await props.requestSelect({
      collectionId: props.collectionId,
      folderRefEntryId: props.folderRefEntryId,
      rootPath: props.rootPath,
      childPath: props.item.path,
      streamId: cursor.streamId,
      subscriptionEpoch: cursor.subscriptionEpoch,
    });
  };

  const handleClick = async (event: MouseEvent) => {
    event.stopPropagation();
    if (props.item.isDir) await toggleDirectory();
    else await handleFileClick();
  };

  return (
    <Show when={props.item.isDir || !uiStore.state.hideUnsupportedFiles || isSupported()}>
    <div class="tree-node-wrapper" data-folderref-child={props.item.path}>
      <div
        class="tree-node"
        classList={{
          selected: !props.item.isDir && readiness()?.status === "ready",
          broken: broken() || readiness()?.status === "broken",
          unsupported: !isSupported(),
          "folder-ref-child-checking": readiness()?.status === "checking",
          "folder-ref-child-ghost": readiness()?.status === "broken",
        }}
        style={{ "padding-left": `${props.depth * 16 + 8}px` }}
        role="treeitem"
        tabIndex={-1}
        aria-level={props.depth + 1}
        aria-selected={isOpenSelected() ? "true" : "false"}
        aria-disabled={!isSupported() || (!props.item.isDir && readiness()?.status === "broken") ? "true" : undefined}
        aria-expanded={props.item.isDir ? (isExpanded() ? "true" : "false") : undefined}
        aria-busy={loading() || readiness()?.status === "checking" ? "true" : undefined}
        data-tree-item-id={treeId()}
        data-tree-parent-id={props.parentTreeId}
        data-tree-label={displayName()}
        onClick={handleClick}
        title={!isSupported() ? "Unsupported file type: opening is disabled" : props.item.path}
      >
        <div class="tree-node-icon">
          <Show when={broken() || readiness()?.status === "broken"} fallback={<Icon name={props.item.isDir ? "folder" : "file"} size={14} />}>
            <Icon name="warning" size={14} />
          </Show>
        </div>
        <span class="tree-node-name">{displayName()}</span>
        <Show when={loading() || readiness()?.status === "checking"}>
          <div class="tree-node-loading-spinner" aria-label="Checking file readiness" />
        </Show>
        <Show when={props.item.isDir}>
          <div class="tree-node-arrow" style={{ transform: isExpanded() ? "rotate(90deg)" : "none", opacity: broken() ? 0.3 : 1 }}>
            <Icon name="chevron-right" size={12} />
          </div>
        </Show>
      </div>
      <Show when={props.item.isDir && isExpanded() && !broken() && children().length > 0}>
        <div role="group">
          <For each={children()}>
            {(child) => <FolderRefChildRow item={child} depth={props.depth + 1} parentTreeId={treeId()} collectionId={props.collectionId} folderRefEntryId={props.folderRefEntryId} rootPath={props.rootPath} requestSelect={props.requestSelect} />}
          </For>
        </div>
      </Show>
    </div>
    </Show>
  );
}
