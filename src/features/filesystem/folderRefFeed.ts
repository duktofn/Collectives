export interface FolderRefFeedChange { kind: string; entryId?: string; path: string; changedFilePath?: string }

export function shouldReloadFolderRef(change: FolderRefFeedChange, folderPath: string, entryId: string, expanded: boolean, broken: boolean): boolean {
  return !broken && expanded && (change.entryId === entryId || change.path === folderPath || change.changedFilePath?.startsWith(folderPath) === true);
}

export function createFolderRefFeedSubscription(onReload: () => void) {
  let disposed = false;
  return {
    handle(change: FolderRefFeedChange, folderPath: string, entryId: string, expanded: boolean, broken: boolean) {
      if (!disposed && shouldReloadFolderRef(change, folderPath, entryId, expanded, broken)) onReload();
    },
    dispose() { disposed = true; },
  };
}
