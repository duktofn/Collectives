import type { Collection, Entry } from "../../types";

export interface NormalizedEntry {
  collectionId: string;
  id: string;
  parentId: string | null;
  entryType: "file" | "folder-ref" | "group";
  name: string | null;
  path: string | null;
  sortOrder: number;
}

export interface MetadataCacheState {
  collectionId: string;
  entries: Record<string, NormalizedEntry>;
  childrenByParent: Record<string, string[]>;
  activeRevision: number;
  streamId: string;
  sequence: number;
  filesystemStreamId: string;
  filesystemSubscriptionEpoch: string;
  filesystemSequence: number;
  filesystemCursorTrusted: boolean;
  fallbackCount: number;
}

export interface CollectionDeltaV2 {
  collectionId: string;
  revision: number;
  mutationId: string;
  changes: unknown;
  origin: string;
}

const rootKey = "__root__";
const keyFor = (collectionId: string, entryId: string) => `${collectionId}:${entryId}`;

export function emptyMetadataCache(collectionId: string): MetadataCacheState {
  return { collectionId, entries: {}, childrenByParent: { [rootKey]: [] }, activeRevision: 0, streamId: "", sequence: 0, filesystemStreamId: "", filesystemSubscriptionEpoch: "", filesystemSequence: 0, filesystemCursorTrusted: false, fallbackCount: 0 };
}

export function replaceMetadataSnapshot(collection: Collection, revision: number, streamId = "", sequence = 0, fallbackCount = 0): MetadataCacheState {
  const state = emptyMetadataCache(collection.id);
  state.activeRevision = revision;
  state.streamId = streamId;
  state.sequence = sequence;
  state.fallbackCount = fallbackCount;
  const visit = (entries: Entry[], parentId: string | null) => entries.forEach((entry, sortOrder) => {
    const id = entry.id;
    const normalized: NormalizedEntry = entry.type === "group"
      ? { collectionId: collection.id, id, parentId, entryType: "group", name: entry.name, path: null, sortOrder }
      : { collectionId: collection.id, id, parentId, entryType: entry.type, name: null, path: entry.path, sortOrder };
    const key = keyFor(collection.id, id);
    state.entries[key] = normalized;
    const parentKey = parentId ? keyFor(collection.id, parentId) : rootKey;
    (state.childrenByParent[parentKey] ??= []).push(key);
    if (entry.type === "group") visit(entry.children, id);
  });
  visit(collection.entries, null);
  return state;
}

export function materializeCollection(cache: MetadataCacheState, template: Collection): Collection {
  const build = (parentId: string | null): Entry[] => {
    const parentKey = parentId ? keyFor(cache.collectionId, parentId) : rootKey;
    return (cache.childrenByParent[parentKey] ?? []).map((key) => {
      const entry = cache.entries[key];
      if (entry.entryType === "group") return { type: "group", id: entry.id, name: entry.name ?? "", children: build(entry.id) };
      if (entry.entryType === "folder-ref") return { type: "folder-ref", id: entry.id, path: entry.path ?? "" };
      return { type: "file", id: entry.id, path: entry.path ?? "" };
    });
  };
  return { ...template, entries: build(null) };
}

export function installMetadataSnapshot(collection: Collection, revision: number, cursor: { streamId: string; subscriptionEpoch: string; sequence: number }, fallbackCount = 0): MetadataCacheState {
  const cache = replaceMetadataSnapshot(collection, revision, "", 0, fallbackCount);
  return { ...cache, filesystemStreamId: cursor.streamId, filesystemSubscriptionEpoch: cursor.subscriptionEpoch, filesystemSequence: cursor.sequence, filesystemCursorTrusted: true };
}

export function deriveMetadataDeltas(before: MetadataCacheState, after: MetadataCacheState): Array<{ entryId: string; kind: "updated" | "removed"; entry?: { path?: string | null } }> {
  const deltas: Array<{ entryId: string; kind: "updated" | "removed"; entry?: { path?: string | null } }> = [];
  for (const [key, previous] of Object.entries(before.entries)) {
    const next = after.entries[key];
    if (!next) deltas.push({ entryId: previous.id, kind: "removed" });
    else if (JSON.stringify(previous) !== JSON.stringify(next)) deltas.push({ entryId: previous.id, kind: "updated", entry: { path: next.path } });
  }
  return deltas;
}

export interface FilesystemFeedV2 { collectionId: string; streamId: string; subscriptionEpoch: string; sequence: number; overflow: boolean; changes: unknown[] }

export function applyFilesystemFeed(state: MetadataCacheState, feed: FilesystemFeedV2): { state: MetadataCacheState; accepted: boolean; needsSnapshot: boolean } {
  if (feed.collectionId !== state.collectionId || feed.overflow || !Array.isArray(feed.changes) || feed.changes.some((change) => !isRecord(change) || typeof change.kind !== "string" || typeof change.path !== "string") || feed.sequence < 1) return fallback(state);
  const mismatchedCursor = Boolean(state.filesystemStreamId && (feed.streamId !== state.filesystemStreamId || feed.subscriptionEpoch !== state.filesystemSubscriptionEpoch));
  if (mismatchedCursor) return state.filesystemCursorTrusted ? { state, accepted: false, needsSnapshot: false } : fallback(state);
  if (state.filesystemSequence > 0 && feed.sequence !== state.filesystemSequence + 1) return fallback(state);
  return { state: { ...state, filesystemStreamId: feed.streamId, filesystemSubscriptionEpoch: feed.subscriptionEpoch, filesystemSequence: feed.sequence, filesystemCursorTrusted: false }, accepted: true, needsSnapshot: false };
}

export function applyCollectionDelta(state: MetadataCacheState, delta: CollectionDeltaV2): { state: MetadataCacheState; accepted: boolean; needsSnapshot: boolean } {
  if (delta.collectionId !== state.collectionId || delta.revision !== state.activeRevision + 1 || !Array.isArray(delta.changes)) return fallback(state);
  const entries = { ...state.entries };
  for (const raw of delta.changes) {
    if (!isRecord(raw) || typeof raw.entryId !== "string" || (raw.kind !== "added" && raw.kind !== "updated" && raw.kind !== "removed")) return fallback(state);
    if (raw.kind === "removed") { if (!entries[keyFor(state.collectionId, raw.entryId)]) return fallback(state); delete entries[keyFor(state.collectionId, raw.entryId)]; continue; }
    if (!isRecord(raw.entry) || typeof raw.entry.id !== "string" || raw.entry.id !== raw.entryId || typeof raw.entry.entryType !== "string" || !["file", "folder-ref", "group"].includes(raw.entry.entryType) || typeof raw.entry.sortOrder !== "number" || raw.entry.sortOrder < 0 || (raw.entry.parentId !== null && typeof raw.entry.parentId !== "string")) return fallback(state);
    entries[keyFor(state.collectionId, raw.entryId)] = { collectionId: state.collectionId, id: raw.entry.id, parentId: raw.entry.parentId, entryType: raw.entry.entryType as NormalizedEntry["entryType"], name: typeof raw.entry.name === "string" ? raw.entry.name : null, path: typeof raw.entry.path === "string" ? raw.entry.path : null, sortOrder: raw.entry.sortOrder };
  }
  const rebuilt = rebuild(state, entries, delta.revision, state.streamId, state.sequence, state.fallbackCount);
  return rebuilt ? { state: rebuilt, accepted: true, needsSnapshot: false } : fallback(state);
}

function rebuild(previous: MetadataCacheState, entries: Record<string, NormalizedEntry>, revision: number, streamId: string, sequence: number, fallbackCount: number): MetadataCacheState | null {
  const childrenByParent: Record<string, string[]> = { [rootKey]: [] };
  for (const [key, entry] of Object.entries(entries)) {
    if (entry.parentId && !entries[keyFor(previous.collectionId, entry.parentId)]) return null;
    const parentKey = entry.parentId ? keyFor(previous.collectionId, entry.parentId) : rootKey;
    (childrenByParent[parentKey] ??= []).push(key);
  }
  for (const children of Object.values(childrenByParent)) children.sort((left, right) => (entries[left].sortOrder - entries[right].sortOrder) || entries[left].id.localeCompare(entries[right].id));
  for (const entry of Object.values(entries)) {
    const visited = new Set<string>();
    let current: string | null = entry.id;
    while (current) {
      if (visited.has(current)) return null;
      visited.add(current);
      current = entries[keyFor(previous.collectionId, current)]?.parentId ?? null;
    }
  }
  return { ...previous, entries, childrenByParent, activeRevision: revision, streamId, sequence, fallbackCount };
}

function fallback(state: MetadataCacheState) { return { state: { ...state, fallbackCount: state.fallbackCount + 1 }, accepted: false, needsSnapshot: true }; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
