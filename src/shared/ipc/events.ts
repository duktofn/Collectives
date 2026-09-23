import { listen, type Event, type UnlistenFn } from "@tauri-apps/api/event";

export interface EventMap {
  "entry-renamed": { entryId: string; oldPath: string; newPath: string };
  "file-modified": { entryId: string; path: string };
  "entry-deleted": { entryId: string; path: string };
  "folder-changed": { entryId: string; path: string; changedFilePath: string };
  "filesystem-changes-v2": { collectionId: string; streamId: string; subscriptionEpoch: string; sequence: number; overflow: boolean; changes: Array<{ kind: string; entryId?: string; path: string; oldPath?: string; changedFilePath?: string }> };
  "collection-delta-v2": { collectionId: string; revision: number; mutationId: string; changes: unknown; origin: string };
}

export function listenEvent<K extends keyof EventMap>(
  name: K,
  handler: (event: Event<EventMap[K]>) => void | Promise<void>,
): Promise<UnlistenFn> {
  return listen<EventMap[K]>(name, handler);
}
