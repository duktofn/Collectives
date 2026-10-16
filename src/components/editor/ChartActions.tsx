import { render } from 'solid-js/web';
import { ToolbarMenu } from '../common/ToolbarMenu';
import { Icon } from '../common/Icon';

export function mountChartActions(
  host: HTMLElement,
  edit: () => void,
  remove: () => void
): () => void {
  return render(
    () => (
      <ToolbarMenu
        label="Chart actions"
        class="chart-menu-trigger"
        trigger={<Icon name="more" size={18} />}
        items={[
          { label: 'Edit', onSelect: edit },
          { label: 'Delete', onSelect: remove },
        ]}
      />
    ),
    host
  );
}
