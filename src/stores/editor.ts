import { createDocumentSession } from "../features/editor/documentSession";
import { uiStore } from "./ui";

// Preserve the store API; the session is the single owner of document coordination.
export const editorStore = createDocumentSession({
  selectedEntryId: () => uiStore.state.selectedEntryId,
  selectEntry: (id) => uiStore.selectEntry(id),
});
