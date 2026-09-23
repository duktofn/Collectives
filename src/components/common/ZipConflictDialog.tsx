import { createSignal, createEffect, createUniqueId, For, Show } from "solid-js";
import { ZipConflict, ZipResolution } from "../../types";
import { Icon } from "./Icon";
import { ModalLayer } from "./ModalLayer";
import "./ZipConflictDialog.css";

interface ZipConflictDialogProps {
  isOpen: boolean;
  conflicts: ZipConflict[];
  onConfirm: (resolutions: Record<string, ZipResolution>) => void;
  onClose: () => void;
  pending?: boolean;
}

export function ZipConflictDialog(props: ZipConflictDialogProps) {
  const [resolutions, setResolutions] = createSignal<Record<string, ZipResolution>>({});
  const [validationError, setValidationError] = createSignal("");
  const titleId = `zip-conflict-title-${createUniqueId()}`;

  createEffect(() => {
    if (props.isOpen) {
      const initial: Record<string, ZipResolution> = {};
      props.conflicts.forEach((c) => { delete initial[c.conflictId]; });
      setResolutions(initial);
      setValidationError("");
    }
  });

  const setResolution = (entryId: string, res: ZipResolution) => {
    setResolutions((prev) => ({ ...prev, [entryId]: res }));
  };

  const setAllResolutions = (res: ZipResolution) => {
    const updated: Record<string, ZipResolution> = {};
    props.conflicts.forEach((c) => {
      if (c.allowedResolutions.includes(res)) updated[c.conflictId] = res;
    });
    setResolutions(updated);
  };

  const handleConfirm = () => {
    if (props.pending) return;
    const missing = props.conflicts.filter((conflict) => !resolutions()[conflict.conflictId] || !conflict.allowedResolutions.includes(resolutions()[conflict.conflictId]));
    if (missing.length > 0) { setValidationError("Choose a resolution for every conflict before continuing."); return; }
    props.onConfirm(resolutions());
  };

  return (
    <ModalLayer
      pending={props.pending}
      isOpen={props.isOpen}
      labelledBy={titleId}
      overlayClass="dialog-overlay"
      contentClass="zip-conflict-dialog modal-content"
      onClose={props.onClose}
    >
          <div class="modal-header">
            <h3 id={titleId}>Resolve ZIP Import Conflicts</h3>
            <button class="btn btn-text close-btn" aria-label="Close ZIP conflict dialog" disabled={props.pending} onClick={() => props.onClose()}>
              <Icon name="close" size={18} />
            </button>
          </div>

          <div class="modal-body">
            <p class="dialog-desc">
              The following files or folders already exist in the extraction folder. Choose how you want to resolve these conflicts.
            </p>
            <Show when={validationError()}><p class="dialog-error">{validationError()}</p></Show>

            <div class="bulk-actions">
              <span class="bulk-label">Set all to:</span>
              <div class="btn-group">
                <button class="btn btn-sm btn-outline" onClick={() => setAllResolutions("overwrite")}>
                  Overwrite
                </button>
                <button class="btn btn-sm btn-outline" onClick={() => setAllResolutions("rename")}>
                  Rename (Auto Suffix)
                </button>
                <button class="btn btn-sm btn-outline" onClick={() => setAllResolutions("skip")}>
                  Skip
                </button>
              </div>
            </div>

            <div class="conflict-list-container">
              <table class="conflict-table">
                <thead>
                  <tr>
                    <th>Item Name</th>
                    <th>Resolution Action</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={props.conflicts}>
                    {(conflict) => (
                      <tr class="conflict-row">
                        <td class="conflict-info-cell">
                          <span class="conflict-display-name">{conflict.displayName}</span>
                          <span class="conflict-path" title={conflict.targetPath}>
                            {conflict.targetPath} · {conflict.kind}
                          </span>
                          <For each={conflict.originMembers}>{(origin) => <span class="conflict-path">Origin: {origin}</span>}</For>
                        </td>
                        <td class="conflict-action-cell">
                          <div class="resolution-options">
                              <button
                                class="resolution-btn"
                              classList={{ active: resolutions()[conflict.conflictId] === "overwrite" }}
                              disabled={props.pending || !conflict.allowedResolutions.includes("overwrite")}
                                onClick={() => setResolution(conflict.conflictId, "overwrite")}
                            >
                              Overwrite
                            </button>
                              <button
                              class="resolution-btn"
                              classList={{ active: resolutions()[conflict.conflictId] === "rename" }}
                              disabled={props.pending || !conflict.allowedResolutions.includes("rename")}
                                onClick={() => setResolution(conflict.conflictId, "rename")}
                            >
                              Rename
                            </button>
                              <button
                              class="resolution-btn"
                              classList={{ active: resolutions()[conflict.conflictId] === "skip" }}
                              disabled={props.pending || !conflict.allowedResolutions.includes("skip")}
                                onClick={() => setResolution(conflict.conflictId, "skip")}
                            >
                              Skip
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-outline" disabled={props.pending} onClick={() => props.onClose()}>
              Cancel
            </button>
            <button class="btn btn-primary" disabled={props.pending} aria-busy={props.pending ? "true" : "false"} onClick={handleConfirm}>
              Confirm Import
            </button>
          </div>
    </ModalLayer>
  );
}
