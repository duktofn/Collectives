import { createSignal, createUniqueId, For, Show } from "solid-js";
import type { RecoveryDraft } from "../../features/editor/recovery";
import { ModalLayer } from "../common/ModalLayer";
import "./RecoveryDialog.css";

interface RecoveryDialogProps {
  drafts: RecoveryDraft[];
  isOpen: boolean;
  pending?: boolean;
  onLater: () => void;
  onRestore: (draft: RecoveryDraft) => Promise<void>;
  onDiscard: (draft: RecoveryDraft) => void;
}

export function RecoveryDialog(props: RecoveryDialogProps) {
  const titleId = `recovery-title-${createUniqueId()}`;
  const [activeId, setActiveId] = createSignal("");
  const [error, setError] = createSignal("");
  const activeDraft = () => props.drafts.find((draft) => draft.id === activeId()) ?? props.drafts[0];

  return (
    <ModalLayer isOpen={props.isOpen && props.drafts.length > 0} labelledBy={titleId} overlayClass="recovery-dialog-backdrop" contentClass="recovery-dialog" pending={props.pending} onClose={props.onLater}>
      <div class="recovery-dialog-heading">
        <div>
          <h2 id={titleId}>Recovered drafts</h2>
          <p>Collectives found local drafts that were not confirmed as saved. Review before continuing.</p>
        </div>
        <button class="btn btn-text" disabled={props.pending} onClick={props.onLater}>Later</button>
      </div>
      <Show when={props.drafts.length > 1}>
        <label class="recovery-draft-picker">
          <span>Draft to review</span>
          <select value={activeDraft()?.id ?? ""} onChange={(event) => { setActiveId(event.currentTarget.value); setError(""); }}>
            <For each={props.drafts}>{(draft) => <option value={draft.id}>{draft.path}</option>}</For>
          </select>
        </label>
      </Show>
      <Show when={activeDraft()}>
        {(draft) => <>
          <div class="recovery-draft-meta">
            <strong>{draft().path}</strong>
            <span>Saved locally {new Date(draft().updatedAt).toLocaleString()}</span>
          </div>
          <label class="recovery-preview-label">
            <span>Draft preview</span>
            <textarea readOnly value={draft().content.slice(0, 12000)} aria-label="Recovered draft preview" />
          </label>
          <Show when={draft().content.length > 12000}><p class="recovery-preview-truncated">Preview shortened. Restoring brings back the full draft.</p></Show>
          {error() && <p class="recovery-error" role="alert">{error()}</p>}
          <div class="recovery-dialog-actions">
            <button class="btn btn-text" disabled={props.pending} onClick={props.onLater}>Later</button>
            <button class="btn btn-outline" disabled={props.pending} onClick={() => { props.onDiscard(draft()); setError(""); }}>Discard draft</button>
            <button class="btn btn-primary" disabled={props.pending} onClick={async () => {
              setError("");
              try { await props.onRestore(draft()); }
              catch (reason) { setError(String(reason) || "Could not restore this draft."); }
            }}>Restore draft</button>
          </div>
        </>}
      </Show>
    </ModalLayer>
  );
}

