import { describe, expect, it, vi } from "vitest";
import { createAppCloseTransactionHandler } from "./App";
import { runArchiveOperation } from "./workflows/ArchiveWorkflow";
import { createOperationLeaseRegistry } from "./workflows/operationLease";

const event = () => ({ preventDefault: vi.fn() });

describe("Phase 5 App close transaction", () => {
  it("waits for archive lease, deduplicates close, then destroys once", async () => {
    const registry = createOperationLeaseRegistry();
    let settleArchive!: () => void;
    const archive = runArchiveOperation(registry, "archive", () => new Promise<void>((resolve) => { settleArchive = resolve; }));
    const flush = vi.fn(async () => true);
    const destroy = vi.fn(async () => undefined);
    const handler = createAppCloseTransactionHandler(registry, flush, destroy);
    const first = event();
    const second = event();
    const firstClose = handler(first);
    const secondClose = handler(second);
    await Promise.resolve();
    expect(flush).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(second.preventDefault).toHaveBeenCalledOnce();
    settleArchive();
    await archive;
    await firstClose;
    await secondClose;
    expect(flush).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("releases a rejected settings lease and allows a later close", async () => {
    const registry = createOperationLeaseRegistry();
    await expect(runArchiveOperation(registry, "settings import", async () => { throw new Error("settings failed"); })).rejects.toThrow("settings failed");
    const flush = vi.fn(async () => true);
    const destroy = vi.fn(async () => undefined);
    const handler = createAppCloseTransactionHandler(registry, flush, destroy);
    await handler(event());
    expect(flush).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("keeps the window open when the Phase 1 flush fails, then permits retry", async () => {
    const registry = createOperationLeaseRegistry();
    const flush = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const destroy = vi.fn(async () => undefined);
    const errors: unknown[] = [];
    const handler = createAppCloseTransactionHandler(registry, flush, destroy, (error) => errors.push(error));
    await handler(event());
    expect(destroy).not.toHaveBeenCalled();
    await handler(event());
    expect(destroy).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(0);
  });
});
