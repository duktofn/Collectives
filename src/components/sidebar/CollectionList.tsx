import { For, Show, onMount } from "solid-js";
import { collectionsStore } from "../../stores/collections";
import { CollectionItem } from "./CollectionItem";

export function CollectionList() {
  onMount(() => {
    collectionsStore.loadCollections();
  });

  return (
    <div class="collection-list">
      <Show
        when={collectionsStore.state.collections.length > 0}
        fallback={
          <div style={{
            padding: "16px 10px",
            color: "var(--color-text-muted)",
            "font-size": "12.5px",
            "text-align": "center"
          }}>
            No collections yet. Click '+' to create one.
          </div>
        }
      >
        <For each={collectionsStore.state.collections}>
          {(col) => <CollectionItem collection={col} />}
        </For>
      </Show>
    </div>
  );
}
