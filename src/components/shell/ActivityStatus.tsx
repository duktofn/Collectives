type ActivityTone = "neutral" | "success" | "warning" | "danger";

interface ActivityStatusProps {
  label: string;
  tone?: ActivityTone;
  detail?: string;
}

export function ActivityStatus(props: ActivityStatusProps) {
  return (
    <div class={`activity-status activity-status-${props.tone ?? "neutral"}`} role="status" aria-live="off">
      <span class="activity-status-dot" aria-hidden="true" />
      <span>{props.label}</span>
      {props.detail && <span class="activity-status-detail">{props.detail}</span>}
    </div>
  );
}
