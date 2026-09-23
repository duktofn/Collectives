export interface EditorContinuityState {
  selectedEntryId: string | null;
  openPath: string | null;
  dirty: boolean;
  externalConflict: boolean;
}

export interface MetadataEntryDelta { entryId: string; kind: "added" | "updated" | "removed"; entry?: { path?: string | null } }

export function applyMetadataContinuity(state: EditorContinuityState, changes: MetadataEntryDelta[]): EditorContinuityState {
  const next = { ...state };
  for (const change of changes) {
    if (change.entryId !== state.selectedEntryId) continue;
    if (change.kind === "updated" && change.entry?.path && next.openPath) {
      if (next.dirty) next.externalConflict = true;
      else next.openPath = change.entry.path;
    }
    if (change.kind === "removed") {
      if (next.dirty) next.externalConflict = true;
      else { next.selectedEntryId = null; next.openPath = null; }
    }
  }
  return next;
}

export function applyFilesystemConflict(state: EditorContinuityState, path: string): EditorContinuityState {
  return state.openPath === path && state.dirty ? { ...state, externalConflict: true } : state;
}
