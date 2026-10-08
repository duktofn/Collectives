import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { createUniqueId } from "solid-js";
import { searchNoteContent } from "../../features/links";
import { createRequestGeneration } from "../../features/links/requestGeneration";
import type { ContentSearchPage, ContentSearchResult } from "../../shared/ipc/client";
import { ModalLayer } from "../common/ModalLayer";
import { Icon } from "../common/Icon";
import { formatIpcError } from "../../shared/ipc/errors";
import "./SearchDialogs.css";

interface ContentSearchDialogProps {
  isOpen: boolean;
  collectionId: string | null;
  onClose: () => void;
  onOpen: (result: ContentSearchResult) => Promise<boolean>;
}

export function ContentSearchDialog(props: ContentSearchDialogProps) {
  const titleId = `content-search-title-${createUniqueId()}`;
  const listId = `content-search-list-${createUniqueId()}`;
  const [query, setQuery] = createSignal("");
  const [page, setPage] = createSignal<ContentSearchPage | null>(null);
  const [offset, setOffset] = createSignal(0);
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
    page();
    queueMicrotask(() => document.getElementById(`${listId}-option-${index}`)?.scrollIntoView?.({ block: "nearest" }));
  });

  const runSearch = async (value: string, collectionId: string, start: number, request: number) => {
    setLoading(true);
    setError("");
    try {
      const result = await searchNoteContent(collectionId, value.trim(), start, 20);
      if (!requests.isCurrent(request)) return;
      setPage(result);
      setOffset(result.offset);
      setActiveIndex(0);
    } catch (reason) {
      if (!requests.isCurrent(request)) return;
      setPage(null);
      setError(formatIpcError(reason) || "Content search is unavailable.");
    } finally {
      if (requests.isCurrent(request)) setLoading(false);
    }
  };

  createEffect(on(() => props.isOpen, (open) => {
    if (!open) return;
    setQuery("");
    setPage(null);
    setError("");
    setOffset(0);
    queueMicrotask(() => inputRef?.focus());
  }));

  createEffect(on(() => [query(), props.collectionId, props.isOpen] as const, ([value, collectionId, open]) => {
    const request = requests.next();
    if (debounceTimer) clearTimeout(debounceTimer);
    setOffset(0);
    setPage(null);
    if (!open || !collectionId || !value.trim()) {
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    debounceTimer = setTimeout(() => void runSearch(value, collectionId, 0, request), 300);
  }));

  const changePage = (nextOffset: number) => {
    const collectionId = props.collectionId;
    const value = query().trim();
    if (!collectionId || !value || nextOffset < 0) return;
    const request = requests.next();
    setPage(null);
    void runSearch(value, collectionId, nextOffset, request);
  };

  const selectActive = async (index = activeIndex()) => {
    const result = page()?.results[index];
    if (!result || opening() || loading()) return;
    setOpening(true);
    setError("");
    try {
      if (await props.onOpen(result)) props.onClose();
      else setError("The current draft could not be saved, so this result stayed closed.");
    } catch (reason) {
      setError(formatIpcError(reason) || "Could not open this note.");
    } finally {
      setOpening(false);
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent) => {
    if (opening()) return;
    const count = page()?.results.length ?? 0;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(0, count - 1)));
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

  const renderSnippet = (item: ContentSearchResult) => {
    const before = item.snippet.slice(0, item.matchStartUtf16);
    const match = item.snippet.slice(item.matchStartUtf16, item.matchEndUtf16);
    const after = item.snippet.slice(item.matchEndUtf16);
    return <>{before}<mark>{match}</mark>{after}</>;
  };

  return (
    <ModalLayer isOpen={props.isOpen} pending={opening()} labelledBy={titleId} overlayClass="search-dialog-backdrop" contentClass="search-dialog content-search-dialog" onClose={props.onClose}>
      <div class="search-dialog-heading">
        <div>
          <h2 id={titleId}>Search note contents</h2>
          <p>Find a word or phrase across notes in this collection.</p>
        </div>
        <div class="search-dialog-heading-actions"><span class="search-dialog-shortcut">Ctrl/⌘ Shift F</span><button type="button" class="search-dialog-close" aria-label="Close content search" disabled={opening()} onClick={props.onClose}><Icon name="close" size={16} /></button></div>
      </div>
      <div class="search-input-wrap"><Icon name="search" size={18} aria-hidden="true" />
      <input
        ref={inputRef}
        class="search-dialog-input"
        type="search"
        value={query()}
        onInput={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={handleInputKeyDown}
        placeholder="Search note contents…"
        aria-label="Search note contents"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={page()?.results.length ? `${listId}-option-${activeIndex()}` : undefined}
        autocomplete="off"
        disabled={opening()}
        data-modal-initial-focus="true"
      />
      <Show when={query()}><button type="button" class="search-clear" aria-label="Clear search" disabled={opening()} onClick={() => { setQuery(""); inputRef?.focus(); }}><Icon name="close" size={14} /></button></Show>
      </div>
      <div id={listId} class="search-dialog-results" role="listbox" aria-label="Content search results">
        <For each={page()?.results ?? []}>
          {(item, index) => (
            <button
              id={`${listId}-option-${index()}`}
              class="search-dialog-option content-search-result"
              classList={{ active: index() === activeIndex() }}
              type="button"
              role="option"
              aria-selected={index() === activeIndex() ? "true" : "false"}
              disabled={opening() || loading()}
              title={item.path}
              onMouseEnter={() => setActiveIndex(index())}
              onClick={() => void selectActive(index())}
            >
              <span class="search-dialog-option-name">{item.displayName} <small>line {item.lineNumber}</small></span>
              <span class="search-dialog-option-path">{item.path}</span>
              <span class="content-search-snippet">{renderSnippet(item)}</span>
            </button>
          )}
        </For>
        {loading() && <p class="search-dialog-message" role="status">Searching note files in the background…</p>}
        {!loading() && !error() && query().trim() && page()?.results.length === 0 && <p class="search-dialog-message">No matches in the searched notes.</p>}
        {!loading() && !query().trim() && <p class="search-dialog-message">Type a phrase to search note contents.</p>}
      </div>
      <Show when={page()}>
        {(result) => (
          <div class="content-search-footer">
            <span role="status">Searched {result().scannedFiles} Markdown files{result().skippedFiles ? `; ${result().skippedFiles} unavailable or too large` : ""}{result().truncated ? "; the scan reached its safety limit" : ""}. {result().total} matches.</span>
            <div>
              <button class="btn btn-text" disabled={opening() || loading() || offset() === 0} onClick={() => changePage(Math.max(offset() - 20, 0))}>Previous</button>
              <button class="btn btn-text" disabled={opening() || loading() || !result().hasMore} onClick={() => changePage(offset() + 20)}>Next</button>
            </div>
          </div>
        )}
      </Show>
      {error() && <p class="search-dialog-error" role="alert">{error()}</p>}
      {opening() && <p class="search-dialog-message" role="status">Saving current draft and opening note…</p>}
      <div class="search-keyboard-hints"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>Enter</kbd> Open result</span><span><kbd>Esc</kbd> Close</span></div>
    </ModalLayer>
  );
}

