import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { RangeSetBuilder, StateField, EditorState, Extension } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

import { isolateHistory } from '@codemirror/commands';
import type { Chart as ChartInstance } from 'chart.js';
import { mountChartActions } from '../../components/editor/ChartActions';
import { parseChartConfiguration } from '../charts/chartModel';
import { chartPresentation } from '../charts/chartPresentation';

class ChartWidget extends WidgetType {
  private chartInstance: ChartInstance | null = null;
  private container: HTMLElement | null = null;
  private disposeActions: (() => void) | null = null;
  private disposeDialog: (() => void) | null = null;
  private openingDialog = false;
  // Cache YAML validity once at construction to avoid re-parsing in estimatedHeight getter,
  // which CM6 calls frequently during height-map rebuilds.
  private _isValidConfig: boolean;

  constructor(
    public specYaml: string,
    public from: number,
    public to: number,
    public readOnly: boolean
  ) {
    super();
    try {
      parseChartConfiguration(this.specYaml);
      this._isValidConfig = true;
    } catch {
      this._isValidConfig = false;
    }
  }

  eq(other: ChartWidget) {
    return this.specYaml === other.specYaml && this.readOnly === other.readOnly;
  }

  // Accurate height estimation based on actual CSS measurements:
  // .cm-chart-widget-container: margin 24px*2 + padding 16px*2 = 80px chrome
  // Valid chart: chartWrapper height 250px (set in JS) → 80 + 250 = 330px
  // Error case: .cm-chart-error padding 12px*2 + content ~80px + chrome 80px ≈ 180px
  get estimatedHeight() {
    if (this._isValidConfig) return 330;
    return 180;
  }

  updateDOM(_dom: HTMLElement, _view: EditorView): boolean {
    return false;
  }

  toDOM(view: EditorView) {
    const container = document.createElement('div');
    this.container = container;
    container.className = 'cm-chart-widget-container';
    container.dataset.chartState = 'loading';
    container.setAttribute('aria-busy', 'true');

    const isEditable = !this.readOnly;
    const presentation = document.createElement('div');
    presentation.className = 'chart-presentation';
    container.appendChild(presentation);

    // Create wrapper for the chart preview
    const chartWrapper = document.createElement('div');
    chartWrapper.className = 'cm-chart-wrapper';

    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Chart preview');
    chartWrapper.appendChild(canvas);
    presentation.appendChild(chartWrapper);

    const legend = document.createElement('div');
    legend.className = 'chart-percentage-legend';
    legend.hidden = true;
    presentation.appendChild(legend);
    if (isEditable) {
      const actions = document.createElement('div');
      actions.className = 'chart-actions-host';
      container.appendChild(actions);
      this.disposeActions = mountChartActions(
        actions,
        () => {
          void this.editChart(view).catch(showChartError);
        },
        () => this.deleteChart(view)
      );
    }

    // Render Chart
    try {
      const config = chartPresentation(parseChartConfiguration(this.specYaml), legend);
      const chartOptions = config.options as Record<string, any>;
      if (chartOptions.animation !== false)
        chartOptions.animation = {
          ...(typeof chartOptions.animation === 'object' ? chartOptions.animation : {}),
          onComplete: () => view.requestMeasure(),
        };

      // Set up simple styles for container
      chartWrapper.style.height = '250px';
      chartWrapper.style.width = '100%';

      // Keep Chart.js out of startup and load it only when a chart widget enters
      // the rendered viewport.
      void import('chart.js/auto')
        .then(({ default: Chart }) => {
          if (!canvas.isConnected || this.container !== container) return;
          if (this.chartInstance) this.chartInstance.destroy();
          this.chartInstance = new Chart(canvas, config);
          container.dataset.chartState = 'ready';
          container.setAttribute('aria-busy', 'false');
          requestAnimationFrame(() => {
            if (canvas.isConnected) view.requestMeasure();
          });
        })
        .catch((err: unknown) => {
          if (this.container === container) showChartError(err);
        });
    } catch (err: unknown) {
      showChartError(err);
    }

    return container;

    function showChartError(error: unknown) {
      container.dataset.chartState = 'error';
      container.setAttribute('aria-busy', 'false');
      chartWrapper.style.display = 'none';
      const errorDiv = document.createElement('div');
      errorDiv.className = 'cm-chart-error';
      errorDiv.setAttribute('role', 'alert');
      const errorMsg = error instanceof Error ? error.message : String(error);
      const strong = document.createElement('strong');
      strong.textContent = 'Chart Config Error:';
      const pre = document.createElement('pre');
      pre.textContent = errorMsg;
      errorDiv.appendChild(strong);
      errorDiv.appendChild(pre);
      container.appendChild(errorDiv);
      requestAnimationFrame(() => {
        if (container.isConnected) view.requestMeasure();
      });
    }
  }

  destroy() {
    this.disposeDialog?.();
    this.disposeActions?.();
    this.disposeDialog = this.disposeActions = null;
    this.container = null;
    if (this.chartInstance) {
      this.chartInstance.destroy();
      this.chartInstance = null;
    }
  }

  private currentRange(view: EditorView) {
    if (!this.container?.isConnected || view.state.facet(EditorState.readOnly)) return false;
    try {
      const position = view.posAtDOM(this.container);
      const cursor = view.state.field(chartWidgetField, false)?.decorations.iter(position);
      if (!cursor?.value || cursor.from !== position) return false;
      const opening = view.state.doc.lineAt(cursor.from);
      const closing = view.state.doc.lineAt(cursor.to);
      const bodyRange = { from: opening.to + 1, to: closing.from };
      const text = view.state.doc.sliceString(bodyRange.from, bodyRange.to);
      return {
        from: cursor.from,
        to: cursor.to,
        bodyRange,
        source: text.endsWith('\n') ? text.slice(0, -1) : text,
      };
    } catch {
      return false;
    }
  }

  private async editChart(view: EditorView) {
    if (this.disposeDialog || this.openingDialog) return;
    const range = this.currentRange(view);
    if (!range) return;
    this.openingDialog = true;
    try {
      const { openChartEditor } = await import('../../components/editor/ChartEditorDialog');
      if (!this.currentRange(view)) return;
      this.disposeDialog = openChartEditor(
        {
          source: range.source,
          onSave: (source) => this.updateDocument(view, source, range.source),
        },
        () => {
          this.disposeDialog = null;
        }
      );
    } finally {
      this.openingDialog = false;
    }
  }

  private deleteChart(view: EditorView) {
    const range = this.currentRange(view);
    if (!range) return;
    view.dispatch({
      changes: { from: range.from, to: range.to },
      selection: { anchor: range.from },
      userEvent: 'delete.chart',
      annotations: isolateHistory.of('full'),
    });
    view.focus();
  }

  updateDocument(view: EditorView, newSpec: string, expectedSource?: string): boolean {
    try {
      const range = this.currentRange(view);
      if (!range || (expectedSource !== undefined && range.source !== expectedSource)) return false;
      // Replace only YAML so the original fence and following prose survive.
      const insert = newSpec && !newSpec.endsWith('\n') ? `${newSpec}\n` : newSpec;
      view.dispatch({
        changes: { ...range.bodyRange, insert },
        userEvent: 'input.chart',
        annotations: isolateHistory.of('full'),
      });
      queueMicrotask(() => {
        if (view.dom.isConnected) view.focus();
      });
      return true;
    } catch {
      return false;
    }
  }
}

function buildChartDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'FencedCode') return;
      const opening = doc.lineAt(node.from);
      const fence = opening.text.match(/^ {0,3}(`{3,}|~{3,})chart\s*$/)?.[1];
      if (!fence) return false;
      const closing = doc.lineAt(node.to);
      const closingFence = closing.text.match(/^ {0,3}(`{3,}|~{3,})\s*$/)?.[1];
      if (
        closing.number <= opening.number ||
        !closingFence ||
        closingFence[0] !== fence[0] ||
        closingFence.length < fence.length
      )
        return false;
      const bodyFrom = doc.line(opening.number + 1).from;
      const body = bodyFrom >= closing.from ? '' : doc.sliceString(bodyFrom, closing.from);
      const specYaml = body.endsWith('\n') ? body.slice(0, -1) : body;
      builder.add(
        opening.from,
        closing.to,
        Decoration.replace({
          widget: new ChartWidget(
            specYaml,
            opening.from,
            closing.to,
            state.facet(EditorState.readOnly)
          ),
          block: true,
        })
      );
      return false;
    },
  });
  return builder.finish();
}

const chartWidgetField = StateField.define<{
  decorations: DecorationSet;
  tree: ReturnType<typeof syntaxTree>;
}>({
  create(state) {
    return { decorations: buildChartDecorations(state), tree: syntaxTree(state) };
  },
  update(value, tr) {
    const tree = syntaxTree(tr.state);
    if (tr.docChanged || tr.reconfigured || tree !== value.tree) {
      return { decorations: buildChartDecorations(tr.state), tree };
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (value) => value.decorations),
});

export const chartWidgetExtension: Extension = [
  chartWidgetField,
  EditorView.atomicRanges.of((view) => {
    return view.state.field(chartWidgetField, false)?.decorations ?? Decoration.none;
  }),
];
