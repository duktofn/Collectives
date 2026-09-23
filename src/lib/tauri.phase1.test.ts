import { describe, expect, it } from "vitest";
import { asSafetyError } from "./tauri";

describe("Phase 1 command error contract", () => {
  it("discriminates serializable SafetyError and preserves fallback behavior", () => {
    expect(asSafetyError({ code: "external_change_conflict", message: "draft retained", details: { path: "a.md" } })).toEqual({
      code: "external_change_conflict",
      message: "draft retained",
      details: { path: "a.md" },
    });
    expect(asSafetyError(new Error("ordinary failure"))).toBeNull();
  });
});
