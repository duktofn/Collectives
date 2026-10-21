import { describe, expect, it } from "vitest";
import { applyCollectionDelta, applyFilesystemFeed, materializeCollection, replaceMetadataSnapshot } from "./metadataCache";
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


describe("incremental projection work and invariants", () => {
  it("rebuilds only the changed leaf and its ancestors at 10,000 entries", () => {
    const large: Collection = { ...collection, entries: Array.from({ length: 10 }, (_, group) => ({ type: "group" as const, id: `g${group}`, name: `Group ${group}`, children: Array.from({ length: 1000 }, (_, child) => ({ type: "file" as const, id: `f${group}-${child}`, path: `${group}/${child}.md` })) })) };
    const before = replaceMetadataSnapshot(large, 1);
    const result = applyCollectionDelta(before, { collectionId: "c", revision: 2, mutationId: "one", origin: "ui", changes: [{ kind: "updated", entryId: "f0-0", entry: { id: "f0-0", parentId: "g0", entryType: "file", path: "changed.md", sortOrder: 0 } }] });
    expect(result.accepted).toBe(true);
    const built: string[] = [];
    const projected = materializeCollection(result.state, large, (id) => built.push(id));
    expect(built).toEqual(["g0", "f0-0"]);
    expect(projected.entries[1]).toBe(large.entries[1]);
    expect((projected.entries[0] as Extract<Collection["entries"][number], {type:"group"}>).children[1]).toBe((large.entries[0] as Extract<Collection["entries"][number], {type:"group"}>).children[1]);
    expect(result.state.entries["c:f1-0"]).toBe(before.entries["c:f1-0"]);
    expect(result.state.childrenByParent["c:g1"]).toBe(before.childrenByParent["c:g1"]);
    expect(before.entries["c:f0-0"].path).toBe("0/0.md");
  });

  it("moves/reparents and deletes subtrees atomically without losing ordering", () => {
    const initial = replaceMetadataSnapshot(collection, 1);
    const moved = applyCollectionDelta(initial, { collectionId:"c", revision:2, mutationId:"move", origin:"ui", changes:[{kind:"updated",entryId:"a",entry:{id:"a",parentId:null,entryType:"file",path:"a.md",sortOrder:1}}] });
    const projected = materializeCollection(moved.state, collection);
    expect(projected.entries.map(entry=>entry.id)).toEqual(["g","a"]);
    expect((projected.entries[0] as Extract<Collection["entries"][number],{type:"group"}>).children).toEqual([]);
    const removed = applyCollectionDelta(initial, { collectionId:"c",revision:2,mutationId:"remove",origin:"ui",changes:[{kind:"removed",entryId:"g"},{kind:"removed",entryId:"a"}] });
    expect(removed.accepted).toBe(true);
    expect(materializeCollection(removed.state,collection).entries).toEqual([]);
  });

  it.each([
    [{kind:{toString:"invalid"},entryId:"a"}],
    [{kind:"added",entryId:"a",entry:{id:"a",parentId:null,entryType:"file",path:"x.md",sortOrder:0}}],
    [{kind:"updated",entryId:"unknown",entry:{id:"unknown",parentId:null,entryType:"file",path:"x.md",sortOrder:0}}],
    [{kind:"removed",entryId:"g"}],
    [{kind:"updated",entryId:"g",entry:{id:"g",parentId:null,entryType:"file",path:"x.md",sortOrder:0}}],
    [{kind:"updated",entryId:"a",entry:{id:"a",parentId:"a",entryType:"file",path:"x.md",sortOrder:0}}],
    [{kind:"updated",entryId:"a",entry:{id:"a",parentId:"g",entryType:"file",path:"x.md",sortOrder:Infinity}}],
  ])("falls back without mutating the last valid snapshot for invalid changes %j", (...changes) => {
    const before=replaceMetadataSnapshot(collection,1);
    const result=applyCollectionDelta(before,{collectionId:"c",revision:2,mutationId:"bad",origin:"ui",changes});
    expect(result.needsSnapshot).toBe(true);
    expect(result.state.entries).toBe(before.entries);
    expect(materializeCollection(before,collection)).toEqual(collection);
  });
});
