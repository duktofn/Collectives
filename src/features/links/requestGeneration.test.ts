import { describe, expect, it } from "vitest";
import { createRequestGeneration } from "./requestGeneration";

describe("latest request generation", () => {
  it("rejects a stale response after a newer query starts", () => {
    const guard = createRequestGeneration();
    const earlier = guard.next();
    const latest = guard.next();
    expect(guard.isCurrent(earlier)).toBe(false);
    expect(guard.isCurrent(latest)).toBe(true);
  });

  it("invalidates in-flight results when a dialog closes", () => {
    const guard = createRequestGeneration();
    const active = guard.next();
    guard.cancel();
    expect(guard.isCurrent(active)).toBe(false);
  });
});
