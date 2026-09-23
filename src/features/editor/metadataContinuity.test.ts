import { describe, expect, it } from "vitest";
import { applyFilesystemConflict, applyMetadataContinuity } from "./metadataContinuity";

describe("metadata/editor continuity", () => {
  it("keeps the open file and selection coherent across rename and move deltas", () => {
    const current = { selectedEntryId: "entry", openPath: "old.md", dirty: false, externalConflict: false };
    const renamed = applyMetadataContinuity(current, [{ entryId: "entry", kind: "updated", entry: { path: "new.md" } }]);
    expect(renamed.selectedEntryId).toBe("entry");
    expect(renamed.openPath).toBe("new.md");
    const moved = applyMetadataContinuity(renamed, [{ entryId: "entry", kind: "updated", entry: { path: "new.md" } }]);
    expect(moved.selectedEntryId).toBe("entry");
    expect(moved.openPath).toBe("new.md");
  });

  it("preserves a dirty draft when metadata delete or filesystem change conflicts", () => {
    const dirty = { selectedEntryId: "entry", openPath: "new.md", dirty: true, externalConflict: false };
    const deleted = applyMetadataContinuity(dirty, [{ entryId: "entry", kind: "removed" }]);
    expect(deleted.selectedEntryId).toBe("entry");
    expect(deleted.openPath).toBe("new.md");
    expect(deleted.externalConflict).toBe(true);
    expect(applyFilesystemConflict(dirty, "new.md").externalConflict).toBe(true);
  });

  it("clears clean selection only after a deleted entry delta", () => {
    const clean = { selectedEntryId: "entry", openPath: "new.md", dirty: false, externalConflict: false };
    const deleted = applyMetadataContinuity(clean, [{ entryId: "entry", kind: "removed" }]);
    expect(deleted.selectedEntryId).toBeNull();
    expect(deleted.openPath).toBeNull();
  });
});
