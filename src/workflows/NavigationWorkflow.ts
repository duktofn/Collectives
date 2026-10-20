import { collectionsStore } from "../stores/collections";
import { editorStore } from "../stores/editor";
import { uiStore } from "../stores/ui";
import type { Entry, ResolveCandidate } from "../types";
import type { ContentSearchResult } from "../features/links";
import { peekHistoryTarget, cancelHistoryNavigation } from "../features/editor/navigationHistory";

export function createNavigationWorkflow(showAppNotice: (title: string, error: unknown) => void) {
  let selectionTransition: Promise<void> = Promise.resolve();
  const restoreDisplayedSelection = () => {
    const path = editorStore.state.openFilePath;
    if (!path) return;
    const findFile = (entries: Entry[]): string | null => {
      for (const entry of entries) {
        if (entry.type === "file" && entry.path === path) return entry.id;
        if (entry.type === "group") {
          const found = findFile(entry.children);
          if (found) return found;
        }
      }
      return null;
    };
    uiStore.selectEntry(findFile(collectionsStore.activeCollection()?.entries ?? []) ?? path);
  };
  const queueSelectionTransition = (transition: () => Promise<void>) => {
    selectionTransition = selectionTransition
      .then(transition)
      .catch((error) => showAppNotice("Selection transition failed", error));
  };

  const openQuickCandidate = async (candidate: ResolveCandidate): Promise<boolean> => {
    const collectionId = collectionsStore.state.activeCollectionId;
    const selected = await editorStore.selectEntry(candidate.entryId);
    if (!selected) return false;
    // Selection already queues a file open; let it settle before any fallback read.
    await selectionTransition;
    if (uiStore.state.selectedEntryId !== candidate.entryId
      || collectionsStore.state.activeCollectionId !== collectionId) return false;
    if (editorStore.state.openFilePath !== candidate.path) await editorStore.openFile(candidate.path);
    return editorStore.state.openFilePath === candidate.path;
  };

  const openContentResult = async (result: ContentSearchResult): Promise<boolean> => {
    const opened = await openQuickCandidate({
      displayName: result.displayName,
      entryId: result.entryId,
      path: result.path,
      entryType: "file",
    });
    if (opened) editorStore.navigateToPosition(result.path, result.lineNumber, result.columnUtf16);
    return opened;
  };

  const navigateHistory = async (direction: "back" | "forward") => {
    const collectionId = collectionsStore.state.activeCollectionId;
    if (!collectionId) return false;
    const target = peekHistoryTarget(collectionId, direction);
    if (!target) return false;
    const opened = await openQuickCandidate(target);
    if (!opened) cancelHistoryNavigation(collectionId);
    return opened;
  };

  return { queueSelectionTransition, restoreDisplayedSelection, openQuickCandidate, openContentResult, navigateHistory };
}
