import { describe, expect, it, vi } from "vitest";
import { createCloseRequestHandler } from "./App";

describe("Phase 1 application safety contract", () => {
  it("keeps the App entrypoint available for close/selection integration coverage", async () => {
    const module = await import("./App");
    expect(module.default).toBeTypeOf("function");
  });

  it("prevents re-entrant window close and destroys only after a successful flush", async () => {
    let resolveClose: ((closed: boolean) => void) | undefined;
    const close = vi.fn(() => new Promise<boolean>((resolve) => { resolveClose = resolve; }));
    const destroy = vi.fn(async () => undefined);
    const handler = createCloseRequestHandler(close, destroy);
    const firstEvent = { preventDefault: vi.fn() };
    const secondEvent = { preventDefault: vi.fn() };
    const first = handler(firstEvent);
    const second = handler(secondEvent);
    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    expect(secondEvent.preventDefault).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(destroy).not.toHaveBeenCalled();
    resolveClose?.(true);
    await first;
    await second;
    expect(destroy).toHaveBeenCalledOnce();
  });
});
