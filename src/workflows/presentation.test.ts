import { describe, expect, it } from "vitest";
import { archiveSubmitDisabled, closeMustWaitForOperations, shouldRenderEmptyWorkspace } from "./presentation";

describe("workflow presentation selectors", () => {
  it("keeps long-operation submit/close state indeterminate and blocked", () => {
    const state = { activeLeaseCount: 1, operationPending: true, archiveDialogOpen: true, hasSelection: true };
    expect(archiveSubmitDisabled(state)).toBe(true);
    expect(closeMustWaitForOperations(state)).toBe(true);
    expect(shouldRenderEmptyWorkspace(state)).toBe(false);
  });
});
