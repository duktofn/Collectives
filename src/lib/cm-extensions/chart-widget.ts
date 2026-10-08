import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder, StateField, EditorState, Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

import * as yaml from "js-yaml";
import type { Chart as ChartInstance } from "chart.js";

class ChartWidget extends WidgetType {
  private chartInstance: ChartInstance | null = null;
  private container: HTMLElement | null = null;
  // Cache YAML validity once at construction to avoid re-parsing in estimatedHeight getter,
  // which CM6 calls frequently during height-map rebuilds.
  private _isValidConfig: boolean;

  constructor(
    public specYaml: string,
    public from: number,
    public to: number
  ) {
    super();
    try {
      const parsed = yaml.load(this.specYaml);
      this._isValidConfig = !!(parsed && typeof parsed === "object");
    } catch {
      this._isValidConfig = false;
    }
  }

  eq(other: ChartWidget) {
    return this.specYaml === other.specYaml;
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
    const container = document.createElement("div");
    this.container = container;
    container.className = "cm-chart-widget-container";

    const isEditable = !view.state.facet(EditorState.readOnly);

    // Create wrapper for the chart preview
    const chartWrapper = document.createElement("div");
    chartWrapper.className = "cm-chart-wrapper";
    
    const canvas = document.createElement("canvas");
    chartWrapper.appendChild(canvas);
    container.appendChild(chartWrapper);

    // Create container for the editor (textarea)
    const editorWrapper = document.createElement("div");
    editorWrapper.className = "cm-chart-editor-wrapper";
    editorWrapper.style.display = "none";

    const textarea = document.createElement("textarea");
    textarea.className = "cm-chart-textarea";
    textarea.value = this.specYaml;
    editorWrapper.appendChild(textarea);

    const editButton = document.createElement("button");
    editButton.className = "btn btn-secondary cm-chart-edit-source-btn";
    editButton.type = "button";
    editButton.textContent = "Edit chart source";
    editButton.setAttribute("aria-label", "Edit chart source");
    container.appendChild(editButton);

    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-primary btn-sm cm-chart-save-btn";
    saveBtn.textContent = "Apply";
    editorWrapper.appendChild(saveBtn);

    container.appendChild(editorWrapper);

    // Render Chart
    try {
      const config = yaml.load(this.specYaml) as Record<string, any>;
      if (!config || typeof config !== "object") {
        throw new Error("YAML must define a configuration object.");
      }

      // Default fallback types and properties
      const chartType = config.type || "bar";
      const chartData = config.data || { labels: [], datasets: [] };
      const chartOptions = config.options || {
        responsive: true,
        maintainAspectRatio: false,
      };

      // Set up simple styles for container
      chartWrapper.style.height = "250px";
      chartWrapper.style.width = "100%";

      // Keep Chart.js out of startup and load it only when a chart widget enters
      // the rendered viewport.
      void import("chart.js/auto").then(({ default: Chart }) => {
        if (!canvas.isConnected || this.container !== container) return;
        if (this.chartInstance) this.chartInstance.destroy();
        this.chartInstance = new Chart(canvas, {
          type: chartType,
          data: chartData,
          options: {
            ...chartOptions,
            animation: {
              ...(typeof chartOptions.animation === "object" ? chartOptions.animation : {}),
              onComplete: () => view.requestMeasure(),
            },
          },
        });
        requestAnimationFrame(() => {
          if (canvas.isConnected) view.requestMeasure();
        });
      }).catch((err: unknown) => {
        showChartError(err);
      });
    } catch (err: unknown) {
      showChartError(err);
    }

    if (isEditable) {
      // Toggle editor on click of chart or error block
      const toggleEditor = () => {
        if (editorWrapper.style.display === "none") {
          editorWrapper.style.display = "block";
          textarea.focus();
        } else {
          editorWrapper.style.display = "none";
        }
        // Notify CM6 that the widget's DOM height changed due to showing/hiding
        // the YAML editor panel, so it can re-measure and update the height map.
        view.requestMeasure();
      };

      chartWrapper.addEventListener("click", toggleEditor);
      editButton.addEventListener("click", toggleEditor);

      saveBtn.addEventListener("click", () => {
        const currentView = EditorView.findFromDOM(container) || view;
        const newSpec = textarea.value;
        this.updateDocument(currentView, newSpec);
      });
    }

    return container;

    function showChartError(error: unknown) {
      if (!container.isConnected) return;
      chartWrapper.style.display = "none";
      const errorDiv = document.createElement("div");
      errorDiv.className = "cm-chart-error";
      const errorMsg = error instanceof Error ? error.message : String(error);
      const strong = document.createElement("strong");
      strong.textContent = "Chart Config Error:";
      const pre = document.createElement("pre");
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
    if (this.chartInstance) {
      this.chartInstance.destroy();
      this.chartInstance = null;
    }
  }

  updateDocument(view: EditorView, newSpec: string) {
    let from = this.from;
    let to = this.to;
    if (this.container && this.container.isConnected) {
      try {
        const pos = view.posAtDOM(this.container);
        const chartField = view.state.field(chartWidgetField, false);
        if (chartField) {
          let foundRange: any = null;
          chartField.between(pos, pos + 1, (f, t, _value: any) => {
            foundRange = { from: f, to: t };
            return false;
          });
          if (foundRange) {
            from = foundRange.from;
            to = foundRange.to;
          } else {
            from = pos;
            to = pos + `\`\`\`chart\n${this.specYaml}\n\`\`\``.length;
          }
        } else {
          from = pos;
          to = pos + `\`\`\`chart\n${this.specYaml}\n\`\`\``.length;
        }
      } catch (e) {
        console.error("Error finding chart position via posAtDOM:", e);
      }
    }

    const serialized = `\`\`\`chart\n${newSpec}\n\`\`\``;
    view.dispatch({
      changes: {
        from: from,
        to: to,
        insert: serialized,
      },
    });
  }
}

function buildChartDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;
      const opening = doc.lineAt(node.from);
      if (!opening.text.trim().startsWith("```chart")) return false;
      const closing = doc.lineAt(node.to);
      if (closing.number <= opening.number || closing.text.trim() !== "```") return false;
      const bodyFrom = doc.line(opening.number + 1).from;
      const body = bodyFrom >= closing.from ? "" : doc.sliceString(bodyFrom, closing.from);
      const specYaml = body.endsWith("\n") ? body.slice(0, -1) : body;
      builder.add(
        opening.from,
        closing.to,
        Decoration.replace({
          widget: new ChartWidget(specYaml, opening.from, closing.to),
          block: true,
        }),
      );
      return false;
    },
  });
  return builder.finish();
}

const chartWidgetField = StateField.define<DecorationSet>({
  create(state) {
    return buildChartDecorations(state);
  },
  update(decorations, tr) {
    if (tr.docChanged) {
      return buildChartDecorations(tr.state);
    }
    return decorations.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const chartWidgetExtension: Extension = [
  chartWidgetField,
  EditorView.atomicRanges.of((view) => {
    return view.state.field(chartWidgetField, false) ?? Decoration.none;
  }),
];
