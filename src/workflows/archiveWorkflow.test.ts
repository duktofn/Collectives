import { describe, expect, it } from "vitest";
import { runArchiveOperation } from "./ArchiveWorkflow";
import { createOperationLeaseRegistry } from "./operationLease";

describe("ArchiveWorkflow lease behavior", () => {
  it("releases a lease on rejection and does not orphan close", async () => {
    const registry = createOperationLeaseRegistry();
    await expect(runArchiveOperation(registry, "synthetic archive", async () => { throw new Error("synthetic failure"); })).rejects.toThrow("synthetic failure");
    expect(registry.activeCount()).toBe(0);
    await registry.waitForIdle();
  });
});
