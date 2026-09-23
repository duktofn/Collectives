import { describe, expect, it } from "vitest";
import { createOperationLeaseRegistry } from "./operationLease";

describe("workflow operation leases", () => {
  it("waits for an active operation and releases idempotently", async () => {
    const registry = createOperationLeaseRegistry();
    const lease = registry.register("synthetic archive");
    let idle = false;
    const waiting = registry.waitForIdle().then(() => { idle = true; });
    await Promise.resolve();
    expect(idle).toBe(false);
    expect(registry.activeLabels()).toEqual(["synthetic archive"]);
    lease.release();
    lease.release();
    await waiting;
    expect(idle).toBe(true);
    expect(registry.activeCount()).toBe(0);
  });

  it("deduplicates close waiters across multiple leases", async () => {
    const registry = createOperationLeaseRegistry();
    const first = registry.register("first");
    const second = registry.register("second");
    const settled = Promise.all([registry.waitForIdle(), registry.waitForIdle()]);
    first.release();
    expect(registry.activeCount()).toBe(1);
    second.release();
    await settled;
    expect(registry.activeLabels()).toEqual([]);
  });
});
