import { For, createSignal } from "solid-js";
import { ModalLayer } from "../common/ModalLayer";
import type { NoteLinkCandidate } from "../../types";
import type { NoteLinkNavigationRequest } from "../../features/links/noteLinkServices";

interface NoteLinkCandidatesProps {
  request: NoteLinkNavigationRequest;
  pending: boolean;
  onSelect: (candidate: NoteLinkCandidate) => void;
  onCancel: () => void;
}

export function NoteLinkCandidates(props: NoteLinkCandidatesProps) {
  const [activeIndex, setActiveIndex] = createSignal(0);
  const titleId = `note-link-candidates-${props.request.contextId}-${props.request.requestId}`;

  const focusCandidate = (index: number) => {
    const count = props.request.candidates.length;
    if (count === 0) return;
    const next = Math.max(0, Math.min(index, count - 1));
    setActiveIndex(next);
    queueMicrotask(() => document.getElementById(`${titleId}-option-${next}`)?.focus());
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (props.pending) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusCandidate(activeIndex() + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusCandidate(activeIndex() - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusCandidate(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusCandidate(props.request.candidates.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const candidate = props.request.candidates[activeIndex()];
      if (candidate) props.onSelect(candidate);
    }
  };

  return (
    <ModalLayer
      isOpen={true}
      labelledBy={titleId}
      describedBy={`${titleId}-description`}
      onClose={props.onCancel}
    >
      <section aria-busy={props.pending}>
        <header>
          <h2 id={titleId}>Choose a note for [[{props.request.noteName}]]</h2>
          <p id={`${titleId}-description`}>More than one note has this name. Choose the path you want to open.</p>
        </header>
        <ol role="listbox" aria-label="Matching notes" onKeyDown={onKeyDown}>
          <For each={props.request.candidates}>
            {(candidate, index) => (
              <li role="presentation">
                <button
                  id={`${titleId}-option-${index()}`}
                  class="btn btn-text"
                  type="button"
                  role="option"
                  aria-selected={activeIndex() === index()}
                  tabIndex={activeIndex() === index() ? 0 : -1}
                  data-modal-initial-focus={index() === activeIndex() ? "true" : undefined}
                  title={candidate.path}
                  disabled={props.pending}
                  onFocus={() => setActiveIndex(index())}
                  onClick={() => props.onSelect(candidate)}
                >
                  <strong>{candidate.displayName}</strong>
                  <small>{candidate.path}</small>
                </button>
              </li>
            )}
          </For>
        </ol>
        {props.pending && <p role="status">Opening the selected note…</p>}
        <footer>
          <button class="btn btn-text" type="button" onClick={props.onCancel}>
            Cancel
          </button>
        </footer>
      </section>
    </ModalLayer>
  );
}
