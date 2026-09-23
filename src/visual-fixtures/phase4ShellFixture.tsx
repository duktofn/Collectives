import { For, Show, createSignal } from "solid-js";
import "./phase4VisualFixture.css";

const states = ["empty", "active", "loading", "saving", "error", "dialog", "zip", "theme", "long-names"] as const;
type FixtureState = typeof states[number];
type ThemeMode = "dark" | "light" | "system";

const sampleEntries = ["Quarterly planning notes with an intentionally long title.md", "Research / Design references", "Meeting notes — August 2026.md"];

export function Phase4ShellFixture() {
  const initial = (new URLSearchParams(window.location.search).get("state") as FixtureState | null) ?? "active";
  const [state, setState] = createSignal<FixtureState>(states.includes(initial) ? initial : "active");
  const params = new URLSearchParams(window.location.search);
  const [themeMode, setThemeMode] = createSignal<ThemeMode>((params.get("theme") as ThemeMode | null) ?? "dark");
  const systemMatchMedia = params.get("system") === "dark" ? "dark" : "light";
  const effectiveTheme = () => themeMode() === "system" ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : themeMode();
  const empty = () => state() === "empty";
  return (
    <div class="phase4-fixture" data-phase4-fixture="phase4-shell-v1" data-state={state()} data-theme={themeMode()} data-resolved-theme={effectiveTheme()} data-theme-mode={themeMode()} data-system-match-media={themeMode() === "system" ? systemMatchMedia : "not-applicable"}>
      <aside class="fixture-sidebar" aria-label="Collections navigation">
        <div class="fixture-brand">Collectives <button aria-label="Collapse sidebar">≪</button></div>
        <div class="fixture-collection">Sample Collection</div>
        <nav aria-label="Sample collection entries">
          <For each={sampleEntries}>{(entry) => <button class="fixture-tree-entry" title={entry}>{entry}</button>}</For>
        </nav>
        <div class="fixture-sidebar-footer"><button>New Collection</button><button>Settings</button></div>
      </aside>
      <main class="fixture-main">
        <header class="fixture-header"><div><strong>{empty() ? "Workspace" : "Quarterly planning notes with an intentionally long title.md"}</strong><small>Sample Collection / Workspace</small></div><div class="fixture-actions"><button aria-label="Save">Save</button><button aria-label="Close">Close</button></div></header>
        <div class="fixture-status" role="status"><span class={`fixture-dot fixture-${state()}`} />{state() === "saving" ? "Saving changes…" : state() === "error" ? "Save failed — Retry or Reload and discard local draft" : state() === "loading" ? "Loading workspace…" : "Ready"}</div>
        <section class="fixture-body" aria-label="Workspace body">
          <Show when={empty()} fallback={<div class="fixture-editor"><div class="fixture-editor-line"># Sample Collection</div><div class="fixture-editor-line">Synthetic visual evidence only. No files or user data are loaded.</div><div class="fixture-editor-line">[[Design references]]</div></div>}>
            <div class="fixture-empty"><div class="fixture-empty-icon">✦</div><h1>Start a workspace</h1><p>Create a collection to begin organizing local Markdown notes.</p><button class="fixture-primary">New Collection</button><div><button>Import Folder</button><button>Import ZIP</button></div></div>
          </Show>
        </section>
        <div class="fixture-state-controls" aria-label="Fixture state controls"><For each={states}>{(item) => <button classList={{ selected: state() === item }} onClick={() => setState(item)}>{item}</button>}</For><button onClick={() => setThemeMode(themeMode() === "dark" ? "light" : themeMode() === "light" ? "system" : "dark")}>Toggle theme</button></div>
        <Show when={state() === "dialog" || state() === "zip" || state() === "theme"}><div class="fixture-modal-backdrop"><section class={`fixture-modal fixture-modal-${state()}`} role="dialog" aria-modal="true" aria-labelledby="fixture-modal-title"><h2 id="fixture-modal-title">{state() === "zip" ? "Resolve ZIP Import Conflicts" : state() === "theme" ? "Theme settings" : "Create collection"}</h2><p>Modal and drawer visual fixture state.</p><div class="fixture-modal-content">{state() === "zip" ? "Long archive member names and resolution controls" : "Synthetic controls"}</div><button>Cancel</button><button class="fixture-primary">Confirm</button></section></div></Show>
      </main>
    </div>
  );
}
