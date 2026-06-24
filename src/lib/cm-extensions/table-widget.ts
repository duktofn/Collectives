import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

class TableWidget extends WidgetType {
  constructor(
    public markdown: string,
    public from: number,
    public to: number
  ) {
    super();
  }

  eq(other: TableWidget) {
    return (
      this.markdown === other.markdown &&
      this.from === other.from &&
      this.to === other.to
    );
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    if (dom.contains(document.activeElement)) {
      return true;
    }
    return false;
  }

  toDOM(view: EditorView) {
    const container = document.createElement("div");
    container.className = "cm-table-widget-container";

    const lines = this.markdown
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) {
      container.textContent = this.markdown;
      return container;
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

    const isEditable = view.state.readOnly === false;

    // Header
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    headers.forEach((headerText, colIndex) => {
      const th = document.createElement("th");
      th.textContent = headerText;
      if (isEditable) {
        th.contentEditable = "true";
        th.addEventListener("blur", () => {
          headers[colIndex] = th.textContent || "";
          this.updateDocument(view, headers, rows);
        });
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
            if (!rows[rowIndex]) rows[rowIndex] = [];
            rows[rowIndex][colIndex] = td.textContent || "";
            this.updateDocument(view, headers, rows);
          });
          td.addEventListener("keydown", (e) => {
            if (e.key === "Tab") {
              e.preventDefault();
              const next = e.shiftKey
                ? (td.previousElementSibling as HTMLElement)
                : (td.nextElementSibling as HTMLElement);
              if (next) next.focus();
            }
          });
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
        const newRow = new Array(headers.length).fill("");
        rows.push(newRow);
        this.updateDocument(view, headers, rows);
      });

      const addColBtn = document.createElement("button");
      addColBtn.className = "btn-table-control";
      addColBtn.textContent = "+ Col";
      addColBtn.addEventListener("click", () => {
        headers.push(`Column ${headers.length + 1}`);
        rows.forEach((r) => r.push(""));
        this.updateDocument(view, headers, rows);
      });

      controls.appendChild(addRowBtn);
      controls.appendChild(addColBtn);
      container.appendChild(controls);
    }

    return container;
  }

  updateDocument(view: EditorView, headers: string[], rows: string[][]) {
    const headerLine = "| " + headers.join(" | ") + " |";
    const sepLine = "| " + headers.map(() => "---").join(" | ") + " |";
    const rowLines = rows.map(
      (r) => "| " + r.map((cell) => cell || "").join(" | ") + " |"
    );
    const serialized = [headerLine, sepLine, ...rowLines].join("\n");

    view.dispatch({
      changes: {
        from: this.from,
        to: this.to,
        insert: serialized,
      },
    });
  }
}

class TablePlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.buildDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.buildDecorations(update.view);
    }
  }

  buildDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = view.state.doc;

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
}

export const tableWidgetExtension = ViewPlugin.fromClass(TablePlugin, {
  decorations: (v) => v.decorations,
});
