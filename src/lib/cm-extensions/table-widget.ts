import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder, StateField, EditorState, Extension } from "@codemirror/state";



class TableWidget extends WidgetType {
  private container: HTMLElement | null = null;

  constructor(
    public markdown: string,
    public from: number,
    public to: number
  ) {
    super();
  }

  eq(other: TableWidget) {
    return this.markdown === other.markdown;
  }

  // Accurate height estimation based on actual CSS measurements:
  // .cm-table-widget-container: margin 20px*2 + padding 12px*2 = 64px
  // Header row: ~40px (padding 8px*2 + font + border)
  // Data rows: ~36px each
  // .cm-table-controls bar: ~30px (button + margin-top 8px)
  get estimatedHeight() {
    const lines = this.markdown.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return 80;
    const dataRowCount = Math.max(0, lines.length - 2); // subtract header + separator "---"
    const containerChrome = 64;  // margin 20*2 + padding 12*2
    const controlsBar = 30;      // "+Row/+Col" bar
    return containerChrome + 40 /* header */ + dataRowCount * 36 + controlsBar;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    // Save the index of the currently focused editable cell (if any)
    const activeCellIndex = dom.contains(document.activeElement)
      ? Array.from(dom.querySelectorAll("[contenteditable='true']")).indexOf(document.activeElement as HTMLElement)
      : -1;

    // Re-render the table content into the existing DOM node
    this.renderInto(dom, view);

    // Restore focus to the same cell position
    if (activeCellIndex >= 0) {
      const cells = dom.querySelectorAll("[contenteditable='true']");
      (cells[activeCellIndex] as HTMLElement)?.focus();
    }

    // Notify CM6 that the widget's DOM height may have changed
    view.requestMeasure();
    return true;
  }

  toDOM(view: EditorView) {
    const container = document.createElement("div");
    this.container = container;
    container.className = "cm-table-widget-container";

    this.renderInto(container, view);

    return container;
  }

  /**
   * Builds the table DOM (thead, tbody, controls) inside the given container.
   * Shared by toDOM (initial creation) and updateDOM (in-place patching).
   */
  private renderInto(container: HTMLElement, view: EditorView) {
    // Clear previous content
    container.innerHTML = "";

    const lines = this.markdown
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) {
      container.textContent = this.markdown;
      return;
    }

    const parseRow = (line: string) => {
      let clean = line;
      if (clean.startsWith("|")) clean = clean.slice(1);
      if (clean.endsWith("|")) clean = clean.slice(0, -1);
      return clean.split("|").map((cell) => cell.trim());
    };

    const headers = parseRow(lines[0]);
    const rows = lines.slice(2).map(parseRow);

    const table = document.createElement("table");
    table.className = "cm-table-widget";

    const isEditable = !view.state.facet(EditorState.readOnly);

    const handleTabKey = (e: KeyboardEvent, currentCell: HTMLElement) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const tableEl = currentCell.closest("table");
        if (!tableEl) return;
        const cells = Array.from(tableEl.querySelectorAll("th[contenteditable='true'], td[contenteditable='true']")) as HTMLElement[];
        const index = cells.indexOf(currentCell);
        if (index !== -1) {
          const nextIdx = e.shiftKey ? index - 1 : index + 1;
          if (nextIdx >= 0 && nextIdx < cells.length) {
            cells[nextIdx].focus();
          }
        }
      }
    };

    // Header
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    headers.forEach((headerText, colIndex) => {
      const th = document.createElement("th");
      th.textContent = headerText;
      if (isEditable) {
        th.contentEditable = "true";
        th.addEventListener("blur", () => {
          const currentView = EditorView.findFromDOM(container) || view;
          headers[colIndex] = th.textContent || "";
          this.updateDocument(currentView, headers, rows);
        });
        th.addEventListener("keydown", (e) => handleTabKey(e, th));
      }
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement("tbody");
    rows.forEach((row, rowIndex) => {
      const tr = document.createElement("tr");
      headers.forEach((_, colIndex) => {
        const td = document.createElement("td");
        td.textContent = row[colIndex] || "";
        if (isEditable) {
          td.contentEditable = "true";
          td.addEventListener("blur", () => {
            const currentView = EditorView.findFromDOM(container) || view;
            if (!rows[rowIndex]) rows[rowIndex] = [];
            rows[rowIndex][colIndex] = td.textContent || "";
            this.updateDocument(currentView, headers, rows);
          });
          td.addEventListener("keydown", (e) => handleTabKey(e, td));
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);

    if (isEditable) {
      const controls = document.createElement("div");
      controls.className = "cm-table-controls";

      const addRowBtn = document.createElement("button");
      addRowBtn.className = "btn-table-control";
      addRowBtn.textContent = "+ Row";
      addRowBtn.addEventListener("click", () => {
        const currentView = EditorView.findFromDOM(container) || view;
        const newRow = new Array(headers.length).fill("");
        rows.push(newRow);
        this.updateDocument(currentView, headers, rows);
      });

      const addColBtn = document.createElement("button");
      addColBtn.className = "btn-table-control";
      addColBtn.textContent = "+ Col";
      addColBtn.addEventListener("click", () => {
        const currentView = EditorView.findFromDOM(container) || view;
        headers.push(`Column ${headers.length + 1}`);
        rows.forEach((r) => r.push(""));
        this.updateDocument(currentView, headers, rows);
      });

      controls.appendChild(addRowBtn);
      controls.appendChild(addColBtn);
      container.appendChild(controls);
    }
  }

  updateDocument(view: EditorView, headers: string[], rows: string[][]) {
    const headerLine = "| " + headers.join(" | ") + " |";
    const sepLine = "| " + headers.map(() => "---").join(" | ") + " |";
    const rowLines = rows.map(
      (r) => "| " + r.map((cell) => cell || "").join(" | ") + " |"
    );
    const serialized = [headerLine, sepLine, ...rowLines].join("\n");

    let from = this.from;
    let to = this.to;
    if (this.container && this.container.isConnected) {
      try {
        const pos = view.posAtDOM(this.container);
        const tableField = view.state.field(tableWidgetField, false);
        if (tableField) {
          let foundRange: any = null;
          tableField.between(pos, pos + 1, (f, t, value: any) => {
            foundRange = { from: f, to: t };
            return false;
          });
          if (foundRange) {
            from = foundRange.from;
            to = foundRange.to;
          } else {
            from = pos;
            to = pos + this.markdown.length;
          }
        } else {
          from = pos;
          to = pos + this.markdown.length;
        }
      } catch (e) {
        console.error("Error finding table position via posAtDOM:", e);
      }
    }

    view.dispatch({
      changes: {
        from: from,
        to: to,
        insert: serialized,
      },
    });
  }
}

function buildTableDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;

  let i = 1;
  while (i <= doc.lines) {
    const line = doc.line(i);
    const text = line.text.trim();

    if (text.startsWith("|") && text.includes("|", 1)) {
      if (i < doc.lines) {
        const nextLine = doc.line(i + 1);
        const nextText = nextLine.text.trim();
        const isSeparator =
          nextText.startsWith("|") &&
          /^[|\s\-:]+$/.test(nextText) &&
          nextText.includes("-");

        if (isSeparator) {
          const startPos = line.from;
          let endPos = nextLine.to;
          let lastLineNum = i + 1;

          while (lastLineNum < doc.lines) {
            const nextRow = doc.line(lastLineNum + 1);
            if (nextRow.text.trim().startsWith("|")) {
              endPos = nextRow.to;
              lastLineNum++;
            } else {
              break;
            }
          }

          const tableMarkdown = doc.sliceString(startPos, endPos);
          builder.add(
            startPos,
            endPos,
            Decoration.replace({
              widget: new TableWidget(tableMarkdown, startPos, endPos),
              block: true,
            })
          );

          i = lastLineNum + 1;
          continue;
        }
      }
    }
    i++;
  }
  return builder.finish();
}

const tableWidgetField = StateField.define<DecorationSet>({
  create(state) {
    return buildTableDecorations(state);
  },
  update(decorations, tr) {
    if (tr.docChanged) {
      return buildTableDecorations(tr.state);
    }
    return decorations.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const tableWidgetExtension: Extension = [
  tableWidgetField,
  EditorView.atomicRanges.of((view) => {
    return view.state.field(tableWidgetField, false) ?? Decoration.none;
  }),
];
