import { createSignal, createEffect, For, Show } from "solid-js";
import { ZipConflict, ZipResolution } from "../../types";
import { Icon } from "./Icon";
import "./ZipConflictDialog.css";

interface ZipConflictDialogProps {
  isOpen: boolean;
  conflicts: ZipConflict[];
  onConfirm: (resolutions: Record<string, ZipResolution>) => void;
  onClose: () => void;
}

export function ZipConflictDialog(props: ZipConflictDialogProps) {
  const [resolutions, setResolutions] = createSignal<Record<string, ZipResolution>>({});

  createEffect(() => {
    if (props.isOpen) {
      const initial: Record<string, ZipResolution> = {};
      props.conflicts.forEach((c) => {
        initial[c.entryId] = "overwrite";
      });
      setResolutions(initial);
    }
  });

  const setResolution = (entryId: string, res: ZipResolution) => {
    setResolutions((prev) => ({ ...prev, [entryId]: res }));
  };

  const setAllResolutions = (res: ZipResolution) => {
    const updated: Record<string, ZipResolution> = {};
    props.conflicts.forEach((c) => {
      updated[c.entryId] = res;
    });
    setResolutions(updated);
  };

  const handleConfirm = () => {
    props.onConfirm(resolutions());
  };

  return (
    <Show when={props.isOpen}>
      <div class="modal-backdrop">
        <div class="zip-conflict-dialog modal-content" onClick={(e) => e.stopPropagation()}>
          <div class="modal-header">
            <h3>Resolve ZIP Import Conflicts</h3>
            <button class="btn btn-text close-btn" onClick={props.onClose}>
              <Icon name="close" size={18} />
            </button>
          </div>

          <div class="modal-body">
            <p class="dialog-desc">
              The following files or folders already exist in the extraction folder. Choose how you want to resolve these conflicts.
            </p>

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
                            {conflict.targetPath}
                          </span>
                        </td>
                        <td class="conflict-action-cell">
                          <div class="resolution-options">
                            <button
                              class="resolution-btn"
                              classList={{ active: resolutions()[conflict.entryId] === "overwrite" }}
                              onClick={() => setResolution(conflict.entryId, "overwrite")}
                            >
                              Overwrite
                            </button>
                            <button
                              class="resolution-btn"
                              classList={{ active: resolutions()[conflict.entryId] === "rename" }}
                              onClick={() => setResolution(conflict.entryId, "rename")}
                            >
                              Rename
                            </button>
                            <button
                              class="resolution-btn"
                              classList={{ active: resolutions()[conflict.entryId] === "skip" }}
                              onClick={() => setResolution(conflict.entryId, "skip")}
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
            <button class="btn btn-outline" onClick={props.onClose}>
              Cancel
            </button>
            <button class="btn btn-primary" onClick={handleConfirm}>
              Confirm Import
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
