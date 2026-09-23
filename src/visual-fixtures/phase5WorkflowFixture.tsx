import { For, Show, createSignal } from "solid-js";
import "./phase5WorkflowFixture.css";

const states = ["empty", "active", "folderref-checking", "folderref-broken", "archive-pending", "settings-pending", "error"] as const;
type FixtureState = typeof states[number];

export function Phase5WorkflowFixture() {
  const params = new URLSearchParams(window.location.search);
  const state = createSignal<FixtureState>(states.includes(params.get("state") as FixtureState) ? params.get("state") as FixtureState : "active");
  const theme = params.get("theme") === "system" ? "system" : params.get("theme") === "light" ? "light" : "dark";
  const systemMatch = "light";
  const resolved = theme === "dark" ? "dark" : "light";
  return (
    <div class="phase5-fixture" data-phase5-fixture="workflow-v1" data-state={state[0]()} data-theme={theme} data-resolved-theme={resolved} data-system-match-media={theme === "system" ? systemMatch : "not-applicable"}>
      <aside class="phase5-sidebar" aria-label="Collections navigation">
        <strong>Collectives</strong><span>CollectionWorkspace</span>
        <button>new-note.md</button><button class="phase5-ghost" aria-disabled={state[0]() === "folderref-broken"}>missing-child.md</button>
        <footer><button>New Collection</button><button>Settings</button></footer>
      </aside>
      <main class="phase5-main" aria-label="Workflow workspace">
        <header><strong>{state[0]() === "empty" ? "Workspace" : "new-note.md"}</strong><button aria-label="Save">Save</button></header>
        <div class={`phase5-status phase5-${state[0]()}`} role="status">{state[0]() === "folderref-checking" ? "Checking file readiness…" : state[0]() === "folderref-broken" ? "stale_read: File is not ready yet" : state[0]() === "archive-pending" ? "Import ZIP pending…" : state[0]() === "settings-pending" ? "Import theme pending…" : state[0]() === "error" ? "Save needs attention" : "Saved"}</div>
        <section class="phase5-body">
          <Show when={state[0]() === "empty"} fallback={<div class="phase5-editor"><h1>new-note.md</h1><p>Synthetic workflow fixture; no user paths.</p><code># FolderRef readiness</code></div>}>
            <div class="phase5-empty"><h1>Welcome to Collections</h1><p>Start a local Markdown workspace.</p><button class="phase5-primary">New Collection</button><button>Import Folder</button><button>Import ZIP</button></div>
          </Show>
        </section>
        <Show when={state[0]() === "folderref-broken"}><div class="phase5-notice" role="alert">stale_read: FolderRef child is not ready yet <button>Retry</button></div></Show>
        <Show when={state[0]() === "archive-pending" || state[0]() === "settings-pending"}><div class="phase5-modal-backdrop"><section class="phase5-modal" role="dialog" aria-modal="true" aria-labelledby="phase5-modal-title"><h2 id="phase5-modal-title">{state[0]() === "archive-pending" ? "Import ZIP" : "Appearance settings"}</h2><p>Operation pending; close and duplicate submit disabled.</p><button disabled>Confirm</button><button disabled>Close</button></section></div></Show>
        <nav class="phase5-controls" aria-label="Fixture states"><For each={states}>{(item) => <button classList={{ selected: state[0]() === item }} onClick={() => state[1](item)}>{item}</button>}</For></nav>
      </main>
    </div>
  );
}
