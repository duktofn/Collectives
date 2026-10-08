import { describe, expect, it } from "vitest";
import { IPC_COMMANDS, IPC_EVENTS, IPC_VERSION } from "./generated";
import { asLegacyInvokeError, asSafetyError } from "./errors";

describe("Phase 2 IPC contract", () => {
  it("matches the generated command/event cardinality", () => {
    expect(IPC_VERSION).toBe("ipc.v1");
    expect(IPC_COMMANDS).toHaveLength(39);
    expect(IPC_EVENTS).toHaveLength(4);
  });

  it("preserves SafetyError objects and does not convert legacy rejection values", () => {
    const safety = { code: "external_change_conflict", message: "draft retained", details: { path: "note.md" } };
    expect(asSafetyError(safety)).toBe(safety);
    expect(asSafetyError("legacy rejection")).toBeNull();
    expect(asLegacyInvokeError("legacy rejection")).toEqual({ kind: "legacy-invoke-error", cause: "legacy rejection" });
  });
});
