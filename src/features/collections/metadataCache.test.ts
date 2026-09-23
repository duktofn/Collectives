import { describe, expect, it } from "vitest";
import { applyCollectionDelta, applyFilesystemFeed, replaceMetadataSnapshot } from "./metadataCache";
import type { Collection } from "../../types";

const collection: Collection = { id: "c", schemaVersion: 1, name: "C", createdAt: "", updatedAt: "", entries: [{ type: "group", id: "g", name: "G", children: [{ type: "file", id: "a", path: "a.md" }] }] };

describe("metadata cache v2", () => {
  it("rejects a parent cycle and preserves the last valid snapshot", () => {
    const state = replaceMetadataSnapshot(collection, 1);
    const result = applyCollectionDelta(state, {
      collectionId: "c", revision: 2, mutationId: "cycle", origin: "ui",
      changes: [{ entryId: "g", kind: "updated", entry: { id: "g", parentId: "g", entryType: "group", name: "G", path: null, sortOrder: 0 } }],
    });
    expect(result.accepted).toBe(false);
    expect(result.needsSnapshot).toBe(true);
    expect(result.state.entries).toEqual(state.entries);
    expect(result.state.activeRevision).toBe(1);
  });
  it("normalizes snapshot and applies a validated delta atomically", () => {
    const state = replaceMetadataSnapshot(collection, 1);
    const result = applyCollectionDelta(state, { collectionId: "c", revision: 2, mutationId: "m", origin: "ui", changes: [{ entryId: "a", kind: "updated", entry: { id: "a", parentId: "g", entryType: "file", name: null, path: "b.md", sortOrder: 0 } }] });
    expect(result.accepted).toBe(true);
    expect(result.needsSnapshot).toBe(false);
    expect(result.state.entries["c:a"].path).toBe("b.md");
  });

  it("falls back exactly once for gaps, unknown kinds and invariant failures", () => {
    const state = replaceMetadataSnapshot(collection, 1);
    const gap = applyCollectionDelta(state, { collectionId: "c", revision: 3, mutationId: "m", origin: "watch", changes: [] });
    expect(gap.needsSnapshot).toBe(true);
    expect(gap.state.fallbackCount).toBe(1);
    const bad = applyCollectionDelta(state, { collectionId: "c", revision: 2, mutationId: "m", origin: "watch", changes: [{ entryId: "x", kind: "unknown" }] });
    expect(bad.needsSnapshot).toBe(true);
    expect(bad.state.fallbackCount).toBe(1);
  });

  it("accepts ordered filesystem feeds, and falls back once on overflow/restart epoch", () => {
    const state = replaceMetadataSnapshot(collection, 1);
    const first = applyFilesystemFeed(state, { collectionId: "c", streamId: "s1", subscriptionEpoch: "e1", sequence: 1, overflow: false, changes: [{ kind: "folder-changed", path: "folder", changedFilePath: "folder/a.md" }] });
    expect(first.accepted).toBe(true);
    const second = applyFilesystemFeed(first.state, { collectionId: "c", streamId: "s1", subscriptionEpoch: "e1", sequence: 2, overflow: false, changes: [] });
    expect(second.accepted).toBe(true);
    const restart = applyFilesystemFeed(second.state, { collectionId: "c", streamId: "s2", subscriptionEpoch: "e2", sequence: 1, overflow: false, changes: [] });
    expect(restart.needsSnapshot).toBe(true);
    expect(restart.state.fallbackCount).toBe(1);
    const overflow = applyFilesystemFeed(second.state, { collectionId: "c", streamId: "s1", subscriptionEpoch: "e1", sequence: 3, overflow: true, changes: [] });
    expect(overflow.needsSnapshot).toBe(true);
    expect(overflow.state.fallbackCount).toBe(1);
  });
});
