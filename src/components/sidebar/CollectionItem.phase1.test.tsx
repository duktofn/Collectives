import { describe, expect, it } from "vitest";
import { deriveCollectionExportTarget } from "./CollectionItem";

describe("Phase 1 folder export target", () => {
  it("derives a sanitized child under the picked parent", () => {
    expect(deriveCollectionExportTarget("D:/Exports/", "My: Collection?")).toBe("D:/Exports/My_ Collection_");
  });
});
