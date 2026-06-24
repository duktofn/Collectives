import { autocompletion, CompletionContext, Completion } from "@codemirror/autocomplete";
import { collectionsStore } from "../../stores/collections";
import { searchLinkIndex } from "../tauri";
import { Extension } from "@codemirror/state";

async function wikilinkCompletionSource(context: CompletionContext) {
  // Match `[[` followed by any characters that are not `]`
  const before = context.matchBefore(/\[\[[^\]]*$/);
  if (!before) return null;

  // Extract query: everything after "[["
  const query = before.text.slice(2);
  const collectionId = collectionsStore.state.activeCollectionId;

  if (!collectionId) return null;

  try {
    const candidates = await searchLinkIndex(collectionId, query, 20);
    const options: Completion[] = candidates
      .filter((candidate) => candidate.entryType === "file") // Only link to files (notes)
      .map((candidate) => ({
        label: candidate.displayName,
        type: "text",
        apply: (view, completion, from, to) => {
          view.dispatch({
            changes: {
              from,
              to,
              insert: `[[${completion.label}]]`,
            },
            selection: { anchor: from + 2 + completion.label.length + 2 },
          });
        },
      }));

    return {
      from: before.from,
      options,
      filter: false, // Re-query the backend since the search is remote
    };
  } catch (error) {
    console.error("Failed to query autocomplete search index:", error);
    return null;
  }
}

export const wikilinkAutocomplete: Extension = autocompletion({
  override: [wikilinkCompletionSource],
});
