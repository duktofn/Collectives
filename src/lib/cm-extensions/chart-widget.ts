import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder, StateField, EditorState } from "@codemirror/state";
import * as yaml from "js-yaml";
import { Chart, registerables } from "chart.js";

// Register Chart.js components
Chart.register(...registerables);

class ChartWidget extends WidgetType {
  private chartInstance: Chart | null = null;
  private dom: HTMLElement | null = null;

  constructor(
    public specYaml: string,
    public from: number,
    public to: number
  ) {
    super();
  }

  eq(other: ChartWidget) {
    return this.specYaml === other.specYaml;
  }

  updateDOM(dom: HTMLElement, _view: EditorView): boolean {
    this.dom = dom;
    return false;
  }

  toDOM(view: EditorView) {
    const container = document.createElement("div");
    this.dom = container;
    container.className = "cm-chart-widget-container";

    const isEditable = view.state.readOnly === false;

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

      // Destroy old instance if any
      if (this.chartInstance) {
        this.chartInstance.destroy();
      }

      // Create new instance
      this.chartInstance = new Chart(canvas, {
        type: chartType,
        data: chartData,
        options: chartOptions,
      });
    } catch (err: unknown) {
      // If error, show error details instead
      chartWrapper.style.display = "none";
      const errorDiv = document.createElement("div");
      errorDiv.className = "cm-chart-error";
      const errorMsg = err instanceof Error ? err.message : String(err);
      errorDiv.innerHTML = `<strong>Chart Config Error:</strong><pre>${errorMsg}</pre>`;
      container.appendChild(errorDiv);
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
      };

      chartWrapper.addEventListener("click", toggleEditor);

      saveBtn.addEventListener("click", () => {
        const newSpec = textarea.value;
        this.updateDocument(view, newSpec);
      });
    }

    return container;
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
    if (this.dom) {
      try {
        const currentPos = view.posAtDOM(this.dom);
        if (currentPos !== null && currentPos !== undefined && currentPos >= 0) {
          from = currentPos;
          const oldSerialized = `\`\`\`chart\n${this.specYaml}\n\`\`\``;
          to = from + oldSerialized.length;
        }
      } catch (e) {
        console.error("Error finding chart position in document:", e);
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

  let i = 1;
  while (i <= doc.lines) {
    const line = doc.line(i);
    const text = line.text.trim();

    if (text.startsWith("```chart")) {
      const startPos = line.from;
      let endPos = line.to;
      let lastLineNum = i;
      const specLines: string[] = [];

      let foundClosing = false;
      while (lastLineNum < doc.lines) {
        const nextLine = doc.line(lastLineNum + 1);
        const nextText = nextLine.text.trim();
        if (nextText === "```") {
          endPos = nextLine.to;
          lastLineNum++;
          foundClosing = true;
          break;
        } else {
          specLines.push(nextLine.text);
          endPos = nextLine.to;
          lastLineNum++;
        }
      }

      if (foundClosing) {
        const specYaml = specLines.join("\n");
        builder.add(
          startPos,
          endPos,
          Decoration.replace({
            widget: new ChartWidget(specYaml, startPos, endPos),
            block: true,
          })
        );
        i = lastLineNum + 1;
      } else {
        i++;
      }
      continue;
    }
    i++;
  }
  return builder.finish();
}

export const chartWidgetExtension = StateField.define<DecorationSet>({
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
