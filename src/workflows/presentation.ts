export interface WorkflowPresentationState {
  activeLeaseCount: number;
  operationPending: boolean;
  archiveDialogOpen: boolean;
  hasSelection: boolean;
}

export function archiveSubmitDisabled(state: WorkflowPresentationState): boolean {
  return state.operationPending || state.activeLeaseCount > 0;
}

export function shouldRenderEmptyWorkspace(state: WorkflowPresentationState): boolean {
  return !state.hasSelection && !state.archiveDialogOpen;
}

export function closeMustWaitForOperations(state: WorkflowPresentationState): boolean {
  return state.activeLeaseCount > 0 || state.operationPending;
}
