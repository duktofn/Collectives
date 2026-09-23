import { Show, createEffect } from "solid-js";
import { formatIpcError } from "../../shared/ipc/errors";
import type { FolderRefReadinessRecord } from "../../features/filesystem/folderRefReadiness";
import { announcementKey, announcer } from "../../a11y/announcer";

interface FolderRefReadinessNoticeProps {
  record: FolderRefReadinessRecord | null;
  onRetry: () => void;
}

export function FolderRefReadinessNotice(props: FolderRefReadinessNoticeProps) {
  createEffect(() => {
    const record = props.record;
    if (record?.status === "broken") announcer.alert(formatIpcError(record.error) || "Folder reference file is not ready", announcementKey("urgent-error", record.key, record.status));
  });

  return (
    <Show when={props.record?.status === "broken"}>
      <div class="folder-ref-readiness-notice" data-a11y-error-notice="true">
        <span>{props.record ? formatIpcError(props.record.error) : "File is not ready"}</span>
        <Show when={props.record?.retryable}>
          <button class="btn btn-text" onClick={props.onRetry}>Retry</button>
        </Show>
      </div>
    </Show>
  );
}
