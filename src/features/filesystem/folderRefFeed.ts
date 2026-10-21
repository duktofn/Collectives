import type { FsEntry } from "../../types";

export function reconcileFolderRefChildren(previous: FsEntry[], next: FsEntry[]): FsEntry[] {
  const byPath = new Map(previous.map(entry => [entry.path, entry]));
  return next.map(entry => {
    const old = byPath.get(entry.path);
    return old && old.name === entry.name && old.isDir === entry.isDir && old.size === entry.size && old.isText === entry.isText ? old : entry;
  });
}

export interface FolderRefFeedChange { kind: string; entryId?: string; path: string; changedFilePath?: string }

const cleanPath = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");
export function shouldReloadFolderRef(change: FolderRefFeedChange, folderPath: string, entryId: string, expanded: boolean, broken: boolean): boolean {
  const root = cleanPath(folderPath);
  const changed = change.changedFilePath ? cleanPath(change.changedFilePath) : "";
  return !broken && expanded && (change.entryId === entryId || cleanPath(change.path) === root || changed === root || changed.startsWith(`${root}/`));
}

export function createFolderRefFeedSubscription(onReload: () => void | Promise<void>) {
  let disposed = false;
  let pending = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (disposed || inFlight || timer !== null || !pending) return;
    timer = setTimeout(() => {
      timer = null;
      if (disposed) return;
      pending = false;
      inFlight = true;
      void (async () => {
        try { await onReload(); }
        finally { inFlight = false; schedule(); }
      })();
    }, 0);
  };
  return {
    handle(change: FolderRefFeedChange, folderPath: string, entryId: string, expanded: boolean, broken: boolean) {
      if (!disposed && shouldReloadFolderRef(change, folderPath, entryId, expanded, broken)) { pending = true; schedule(); }
    },
    dispose() { disposed = true; pending = false; if (timer !== null) clearTimeout(timer); timer = null; },
  };
}
