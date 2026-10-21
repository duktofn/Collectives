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

const projectedEntries = new WeakMap<NormalizedEntry, Entry>();

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
    projectedEntries.set(normalized, entry);
    const parentKey = parentId ? keyFor(collection.id, parentId) : rootKey;
    (state.childrenByParent[parentKey] ??= []).push(key);
    if (entry.type === "group") visit(entry.children, id);
  });
  visit(collection.entries, null);
  return state;
}

export function materializeCollection(cache: MetadataCacheState, template: Collection, onBuild?: (id: string) => void): Collection {
  const buildEntry = (key: string): Entry => {
    const normalized = cache.entries[key];
    const existing = projectedEntries.get(normalized);
    if (existing) return existing;
    onBuild?.(normalized.id);
    const entry: Entry = normalized.entryType === "group"
      ? { type: "group", id: normalized.id, name: normalized.name ?? "", children: build(normalized.id) }
      : { type: normalized.entryType, id: normalized.id, path: normalized.path ?? "" };
    projectedEntries.set(normalized, entry);
    return entry;
  };
  const build = (parentId: string | null): Entry[] =>
    (cache.childrenByParent[parentId === null ? rootKey : keyFor(cache.collectionId, parentId)] ?? []).map(buildEntry);
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
  const changed = new Set<string>();
  const structuralParents = new Set<string>();
  const parentKey = (id: string | null) => id === null ? rootKey : keyFor(state.collectionId, id);
  for (const raw of delta.changes) {
    if (!isRecord(raw) || typeof raw.entryId !== "string" || !raw.entryId || (typeof raw.kind !== "string" || !["added", "updated", "removed"].includes(raw.kind))) return fallback(state);
    const key = keyFor(state.collectionId, raw.entryId);
    if (changed.has(key)) return fallback(state);
    changed.add(key);
    const previous = state.entries[key];
    if (raw.kind === "removed") {
      if (!previous) return fallback(state);
      structuralParents.add(parentKey(previous.parentId));
      if (previous.entryType === "group") structuralParents.add(key);
      delete entries[key];
      continue;
    }
    if ((raw.kind === "added" && previous) || (raw.kind === "updated" && !previous)) return fallback(state);
    const value = raw.entry;
    if (!isRecord(value) || value.id !== raw.entryId || (typeof value.entryType !== "string" || !["file", "folder-ref", "group"].includes(value.entryType))
      || !Number.isInteger(value.sortOrder) || (value.sortOrder as number) < 0
      || (value.parentId !== null && (typeof value.parentId !== "string" || !value.parentId))
      || (value.entryType === "group" ? typeof value.name !== "string" : typeof value.path !== "string")) return fallback(state);
    const next: NormalizedEntry = { collectionId: state.collectionId, id: raw.entryId, parentId: value.parentId as string | null, entryType: value.entryType as NormalizedEntry["entryType"], name: typeof value.name === "string" ? value.name : null, path: typeof value.path === "string" ? value.path : null, sortOrder: value.sortOrder as number };
    entries[key] = next;
    if (!previous || previous.parentId !== next.parentId || previous.sortOrder !== next.sortOrder) {
      if (previous) structuralParents.add(parentKey(previous.parentId));
      structuralParents.add(parentKey(next.parentId));
    }
    if (previous?.entryType === "group" && next.entryType !== "group") structuralParents.add(key);
  }
  const childrenByParent = { ...state.childrenByParent };
  for (const parent of structuralParents) {
    const children = (state.childrenByParent[parent] ?? []).filter(key => entries[key] && parentKey(entries[key].parentId) === parent);
    const existing = new Set(children);
    for (const key of changed) {
      if (entries[key] && parentKey(entries[key].parentId) === parent && !existing.has(key)) children.push(key);
    }
    if (parent !== rootKey && children.length && entries[parent]?.entryType !== "group") return fallback(state);
    children.sort((left, right) => entries[left].sortOrder - entries[right].sortOrder || entries[left].id.localeCompare(entries[right].id));
    if (parent !== rootKey && !entries[parent]) delete childrenByParent[parent];
    else childrenByParent[parent] = children;
  }
  // Only changed ancestry can introduce a dangling parent or cycle.
  for (const key of changed) {
    if (!entries[key]) continue;
    const visited = new Set<string>();
    let current: string | null = key;
    while (current !== null) {
      if (visited.has(current)) return fallback(state);
      visited.add(current);
      const entry: NormalizedEntry | undefined = entries[current];
      if (!entry) return fallback(state);
      if (entry.parentId === null) break;
      current = keyFor(state.collectionId, entry.parentId);
      if (entries[current]?.entryType !== "group") return fallback(state);
    }
  }
  // Invalidate the projection keys of affected ancestors, leaving unrelated
  // normalized entries and their projected subtrees shared with the snapshot.
  const invalidated = new Set(changed);
  for (const key of changed) {
    for (const source of [state.entries, entries]) {
      let id = source[key]?.parentId ?? null;
      while (id !== null) {
        const ancestor = keyFor(state.collectionId, id);
        if (entries[ancestor] && !invalidated.has(ancestor)) {
          entries[ancestor] = { ...entries[ancestor] };
          invalidated.add(ancestor);
        }
        id = source[ancestor]?.parentId ?? null;
      }
    }
  }
  return { state: { ...state, entries, childrenByParent, activeRevision: delta.revision }, accepted: true, needsSnapshot: false };
}

function fallback(state: MetadataCacheState) { return { state: { ...state, fallbackCount: state.fallbackCount + 1 }, accepted: false, needsSnapshot: true }; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
