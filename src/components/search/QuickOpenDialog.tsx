import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { createUniqueId } from "solid-js";
import { searchLinkIndex } from "../../features/links";
import { createRequestGeneration } from "../../features/links/requestGeneration";
import type { ResolveCandidate } from "../../types";
import { ModalLayer } from "../common/ModalLayer";
import { Icon } from "../common/Icon";
import { formatIpcError } from "../../shared/ipc/errors";
import "./SearchDialogs.css";

interface QuickOpenDialogProps {
  isOpen: boolean;
  collectionId: string | null;
  onClose: () => void;
  onOpen: (candidate: ResolveCandidate) => Promise<boolean>;
}

export function QuickOpenDialog(props: QuickOpenDialogProps) {
  const titleId = `quick-open-title-${createUniqueId()}`;
  const listId = `quick-open-list-${createUniqueId()}`;
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<ResolveCandidate[]>([]);
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [opening, setOpening] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;
  const requests = createRequestGeneration();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => { clearTimeout(debounceTimer); requests.next(); });
  createEffect(() => {
    const index = activeIndex();
    results();
    queueMicrotask(() => document.getElementById(`${listId}-option-${index}`)?.scrollIntoView?.({ block: "nearest" }));
  });

  createEffect(on(() => props.isOpen, (open) => {
    if (!open) return;
    setQuery("");
    setError("");
    setResults([]);
    setActiveIndex(0);
    queueMicrotask(() => inputRef?.focus());
  }));

  createEffect(on(() => [query(), props.collectionId, props.isOpen] as const, ([value, collectionId, open]) => {
    const request = requests.next();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!open || !collectionId) {
      setLoading(false);
      setError("");
      setResults([]);
      setActiveIndex(0);
      return;
    }
    setLoading(true);
    setResults([]);
    setActiveIndex(0);
    setError("");
    debounceTimer = setTimeout(async () => {
      try {
        const matches = await searchLinkIndex(collectionId, value.trim(), 40);
        if (!requests.isCurrent(request)) return;
        setResults(matches.slice(0, 40));
        setActiveIndex(0);
      } catch (reason) {
        if (!requests.isCurrent(request)) return;
        setResults([]);
        setError(formatIpcError(reason) || "Quick Open could not search this collection.");
      } finally {
        if (requests.isCurrent(request)) setLoading(false);
      }
    }, 140);
  }));

  const selectActive = async (index = activeIndex()) => {
    const candidate = results()[index];
    if (!candidate || opening() || loading()) return;
    setOpening(true);
    setError("");
    try {
      if (await props.onOpen(candidate)) props.onClose();
      else setError("The current draft could not be saved, so this note stayed closed.");
    } catch (reason) {
      setError(formatIpcError(reason) || "Could not open this note.");
    } finally {
      setOpening(false);
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent) => {
    if (opening()) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(0, results().length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      void selectActive();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
    }
  };

  return (
    <ModalLayer isOpen={props.isOpen} pending={opening()} labelledBy={titleId} overlayClass="search-dialog-backdrop" contentClass="search-dialog quick-open-dialog" onClose={props.onClose}>
      <div class="search-dialog-heading">
        <div>
          <h2 id={titleId}>Quick Open</h2>
          <p>Find a note by its name in this collection.</p>
        </div>
        <div class="search-dialog-heading-actions"><span class="search-dialog-shortcut">Ctrl/⌘ P</span><button type="button" class="search-dialog-close" aria-label="Close Quick Open" disabled={opening()} onClick={props.onClose}><Icon name="close" size={16} /></button></div>
      </div>
      <div class="search-input-wrap"><Icon name="search" size={18} aria-hidden="true" />
      <input
        ref={inputRef}
        class="search-dialog-input"
        type="search"
        value={query()}
        onInput={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={handleInputKeyDown}
        placeholder="Search note names…"
        aria-label="Search note names"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={results().length ? `${listId}-option-${activeIndex()}` : undefined}
        autocomplete="off"
        disabled={opening()}
        data-modal-initial-focus="true"
      />
      <Show when={query()}><button type="button" class="search-clear" aria-label="Clear search" disabled={opening()} onClick={() => { setQuery(""); inputRef?.focus(); }}><Icon name="close" size={14} /></button></Show>
      </div>
      <div class="search-results-label">{query().trim() ? "Matching notes" : "Notes in this collection"}<span>{loading() ? "Searching…" : `${results().length} notes`}</span></div>
      <div id={listId} class="search-dialog-results" role="listbox" aria-label="Notes">
        <For each={results()}>
          {(item, index) => (
            <button
              id={`${listId}-option-${index()}`}
              class="search-dialog-option"
              classList={{ active: index() === activeIndex() }}
              type="button"
              role="option"
              aria-selected={index() === activeIndex() ? "true" : "false"}
              disabled={opening() || loading()}
              title={item.path}
              onMouseEnter={() => setActiveIndex(index())}
              onClick={() => void selectActive(index())}
            >
              <Icon name="file" size={18} class="search-result-icon" aria-hidden="true" />
              <span class="search-result-copy"><span class="search-dialog-option-name">{item.displayName}</span><span class="search-dialog-option-path">{item.path}</span></span>
              <span class="search-result-enter" aria-hidden="true">↵</span>
            </button>
          )}
        </For>
        {loading() && <p class="search-dialog-message" role="status">Searching names…</p>}
        {!loading() && !error() && results().length === 0 && <p class="search-dialog-message">{query().trim() ? "No matching notes." : "No notes in this collection yet."}</p>}
      </div>
      {error() && <p class="search-dialog-error" role="alert">{error()}</p>}
      {opening() && <p class="search-dialog-message" role="status">Saving current draft and opening note…</p>}
      <div class="search-keyboard-hints"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>Enter</kbd> Open note</span><span><kbd>Esc</kbd> Close</span></div>
    </ModalLayer>
  );
}

