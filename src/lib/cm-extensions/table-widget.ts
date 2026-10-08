import { EditorState, Extension, RangeSetBuilder, StateField, Transaction } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { isolateHistory, redo, undo } from "@codemirror/commands";
import { findTables, serializeTable, type InlineTableNode, type TableCellModel, type TableModel, type TableSource } from "./table-model";
import { getDelimiterEdit } from "./delimiter-pairs";

const widgetForDOM = new WeakMap<HTMLElement, TableWidget>();
const cleanupForDOM = new WeakMap<HTMLElement, () => void>();

function sourceCell(table: TableModel, row: number, column: number): TableCellModel | undefined {
  return row < 0 ? table.headers[column] : table.rows[row]?.[column];
}

function currentTable(container: HTMLElement, view: EditorView): TableModel | undefined {
  const from = Number(container.dataset.sourceFrom);
  return findTables(view.state).find((table) => table.from === from);
}

function sourceData(table: TableModel): TableSource {
  return {
    headers: table.headers.map((cell) => cell.source),
    rows: table.rows.map((row) => Array.from({ length: table.headers.length }, (_, index) => row[index]?.source ?? "")),
    alignments: table.alignments,
  };
}

function leafSpan(token: InlineTableNode): HTMLSpanElement {
  const span = document.createElement("span");
  span.dataset.sourceFrom = String(token.from);
  span.dataset.sourceTo = String(token.to);
  span.dataset.sourceKind = token.kind;
  span.textContent = token.text;
  return span;
}

function appendInline(parent: HTMLElement, tokens: InlineTableNode[]): void {
  for (const token of tokens) {
    if (token.kind === "strong" || token.kind === "emphasis") {
      const element = document.createElement(token.kind === "strong" ? "strong" : "em");
      appendInline(element, token.children ?? []);
      parent.appendChild(element);
    } else if (token.kind === "code") {
      const element = document.createElement("code");
      element.appendChild(leafSpan(token));
      parent.appendChild(element);
    } else {
      parent.appendChild(leafSpan(token));
    }
  }
}

function renderCell(cell: HTMLElement, model: TableCellModel | undefined): void {
  cell.replaceChildren();
  if (!model) return;
  appendInline(cell, model.inline);
}

function textOffset(root: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(root);
  try { range.setEnd(node, offset); }
  catch { return root.textContent?.length ?? 0; }
  return range.toString().length;
}

function setCaret(root: HTMLElement, offset: number): void {
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (remaining <= node.length) {
      const range = root.ownerDocument.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= node.length;
  }
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function documentSelectionForCell(cell: HTMLElement, model: TableCellModel): { anchor: number; head: number } {
  const selection = cell.ownerDocument.getSelection();
  if (!selection || !cell.contains(selection.anchorNode) || !cell.contains(selection.focusNode)) {
    return { anchor: model.to, head: model.to };
  }
  const position = (node: Node, offset: number) => Math.max(model.from, Math.min(model.to, model.from + textOffset(cell, node, offset)));
  return {
    anchor: position(selection.anchorNode as Node, selection.anchorOffset),
    head: position(selection.focusNode as Node, selection.focusOffset),
  };
}

function restoreCellSelection(cell: HTMLElement, model: TableCellModel, anchor: number, head: number): void {
  const from = Math.max(model.from, Math.min(model.to, anchor)) - model.from;
  const to = Math.max(model.from, Math.min(model.to, head)) - model.from;
  selectTextRange(cell, from, to);
}

function pointAtTextOffset(root: HTMLElement, offset: number): { node: Text; offset: number } {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (remaining <= node.length) return { node, offset: remaining };
    remaining -= node.length;
  }
  const fallback = root.ownerDocument.createTextNode("");
  root.appendChild(fallback);
  return { node: fallback, offset: 0 };
}

function selectTextRange(root: HTMLElement, from: number, to: number): void {
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  const start = pointAtTextOffset(root, from);
  const end = pointAtTextOffset(root, to);
  const range = root.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}

function pointSourceOffset(cell: HTMLElement, event: MouseEvent, model: TableCellModel): number {
  const doc = cell.ownerDocument;
  const range = doc.caretRangeFromPoint?.(event.clientX, event.clientY);
  if (range && cell.contains(range.startContainer)) {
    const parent = range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer as HTMLElement;
    const span = parent?.closest<HTMLElement>("[data-source-from][data-source-to]");
    if (span && cell.contains(span)) {
      const from = Number(span.dataset.sourceFrom);
      const to = Number(span.dataset.sourceTo);
      const displayOffset = range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startOffset
        : textOffset(span, range.startContainer, range.startOffset);
      if (span.dataset.sourceKind === "escape") return displayOffset === 0 ? Math.min(to, from + 1) : to;
      return Math.min(to, from + displayOffset);
    }
    const visibleOffset = textOffset(cell, range.startContainer, range.startOffset);
    return Math.min(model.to, model.from + visibleOffset);
  }
  return model.to;
}

function setActiveControls(container: HTMLElement, row: number, column: number): void {
  const cell = container.querySelector<HTMLElement>(`[data-row-index="${row}"][data-column-index="${column}"]`);
  if (!cell) return;
  container.dataset.activeRow = String(row);
  container.dataset.activeColumn = String(column);
  const shell = container.getBoundingClientRect();
  const rect = cell.getBoundingClientRect();
  const scroll = container.querySelector<HTMLElement>(".cm-table-scroll");
  const scrollRect = scroll?.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const viewportLeft = scrollRect && scroll ? scrollRect.left + scroll.clientLeft : Number.NEGATIVE_INFINITY;
  const viewportRight = scrollRect && scroll ? viewportLeft + scroll.clientWidth : Number.POSITIVE_INFINITY;
  const columnVisible = centerX >= viewportLeft && centerX <= viewportRight;
  for (const control of container.querySelectorAll<HTMLElement>("[data-row-controls], [data-column-controls]")) control.hidden = true;
  const rowControl = container.querySelector<HTMLElement>(`[data-row-controls="${row}"]`);
  if (rowControl) {
    rowControl.hidden = false;
    rowControl.style.left = `${(scrollRect?.right ?? rect.right) - shell.left + 8}px`;
    rowControl.style.right = "auto";
    rowControl.style.top = `${rect.top - shell.top + rect.height / 2 - rowControl.offsetHeight / 2}px`;
  }
  for (const edge of ["top", "bottom"] as const) {
    const control = container.querySelector<HTMLElement>(`[data-column-controls="${column}"][data-edge="${edge}"]`);
    if (!control) continue;
    control.hidden = !columnVisible;
    if (columnVisible) control.style.left = `${centerX - shell.left - control.offsetWidth / 2}px`;
  }
}

function setAllControlsHidden(container: HTMLElement): void {
  for (const control of container.querySelectorAll<HTMLElement>("[data-row-controls], [data-column-controls]")) control.hidden = true;
}

class TableWidget extends WidgetType {
  constructor(public table: TableModel) { super(); }

  eq(other: TableWidget): boolean {
    return this.table.from === other.table.from
      && this.table.to === other.table.to
      && this.table.source === other.table.source;
  }

  get estimatedHeight(): number {
    return Math.max(112, 88 + (this.table.rows.length + 1) * 36);
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-table-widget-container";
    container.setAttribute("role", "group");
    container.setAttribute("aria-label", "Markdown table");
    widgetForDOM.set(container, this);
    this.render(container, view);
    return container;
  }

  updateDOM(container: HTMLElement, view: EditorView): boolean {
    if (container.dataset.sourceFrom !== String(this.table.from)) return false;
    widgetForDOM.set(container, this);
    container.dataset.sourceFrom = String(this.table.from);
    container.dataset.sourceTo = String(this.table.to);
    const activeCell = container.querySelector<HTMLElement>("[data-editing='true']");
    const focusedElement = container.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const focusedCell = focusedElement?.closest<HTMLElement>("[data-row-index][data-column-index]") ?? activeCell;
    const previousRow = Number(focusedCell?.dataset.rowIndex ?? container.dataset.activeRow ?? -1);
    const previousColumn = Number(focusedCell?.dataset.columnIndex ?? container.dataset.activeColumn ?? 0);
    const shapeChanged = container.querySelectorAll("thead th").length !== this.table.headers.length
      || container.querySelectorAll("tbody tr").length !== this.table.rows.length;
    if (activeCell && container.contains(document.activeElement) && !shapeChanged) {
      this.refreshCells(container, view, activeCell);
      setActiveControls(container, Number(activeCell.dataset.rowIndex), Number(activeCell.dataset.columnIndex));
    } else {
      const scrollLeft = container.querySelector<HTMLElement>(".cm-table-scroll")?.scrollLeft ?? 0;
      container.dataset.rendering = "true";
      this.render(container, view);
      delete container.dataset.rendering;
      const scroll = container.querySelector<HTMLElement>(".cm-table-scroll");
      if (scroll) scroll.scrollLeft = scrollLeft;
      if (focusedElement) {
        requestAnimationFrame(() => this.restoreFocus(container, view, previousRow, previousColumn));
      }
    }
    view.requestMeasure();
    return true;
  }

  destroy(container: HTMLElement): void {
    cleanupForDOM.get(container)?.();
    cleanupForDOM.delete(container);
    widgetForDOM.delete(container);
  }

  private render(container: HTMLElement, view: EditorView): void {
    cleanupForDOM.get(container)?.();
    container.replaceChildren();
    container.dataset.sourceFrom = String(this.table.from);
    container.dataset.sourceTo = String(this.table.to);
    const editable = !view.state.facet(EditorState.readOnly);
    const scroll = document.createElement("div");
    scroll.className = "cm-table-scroll";
    const table = document.createElement("table");
    table.className = "cm-table-widget";
    table.setAttribute("role", "grid");

    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    this.table.headers.forEach((model, column) => {
      const cell = this.createCell(model, -1, column, editable);
      headerRow.appendChild(cell);
      cell.style.textAlign = this.table.alignments[column] ?? "left";
    });
    head.appendChild(headerRow);
    table.appendChild(head);

    const body = document.createElement("tbody");
    this.table.rows.forEach((row, rowIndex) => {
      const rowElement = document.createElement("tr");
      this.table.headers.forEach((_, column) => {
        const cell = this.createCell(row[column], rowIndex, column, editable);
        cell.style.textAlign = this.table.alignments[column] ?? "left";
        rowElement.appendChild(cell);
      });
      body.appendChild(rowElement);
    });
    table.appendChild(body);
    scroll.appendChild(table);
    container.appendChild(scroll);

    if (editable) this.renderControls(container, table);
    const onPointerOver = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-row-index][data-column-index]") : null;
      if (!target || !container.contains(target)) return;
      setActiveControls(container, Number(target.dataset.rowIndex), Number(target.dataset.columnIndex));
    };
    const onFocusIn = (event: Event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-row-index][data-column-index]") : null;
      if (target) setActiveControls(container, Number(target.dataset.rowIndex), Number(target.dataset.columnIndex));
    };
    const onKeyDown = (event: KeyboardEvent) => this.handleHistoryShortcut(container, event);
    const onPointerLeave = (event: PointerEvent) => {
      if (event.relatedTarget instanceof Node && container.contains(event.relatedTarget)) return;
      if (container.contains(document.activeElement)) return;
      setAllControlsHidden(container);
    };
    const onScroll = () => {
      const row = Number(container.dataset.activeRow);
      const column = Number(container.dataset.activeColumn);
      if (Number.isInteger(row) && Number.isInteger(column)) setActiveControls(container, row, column);
    };
    container.addEventListener("pointermove", onPointerOver);
    container.addEventListener("focusin", onFocusIn);
    container.addEventListener("keydown", onKeyDown);
    container.addEventListener("pointerleave", onPointerLeave);
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const row = Number(container.dataset.activeRow);
      const column = Number(container.dataset.activeColumn);
      if (Number.isInteger(row) && Number.isInteger(column)) setActiveControls(container, row, column);
    });
    resizeObserver?.observe(container);
    resizeObserver?.observe(scroll);
    scroll.addEventListener("scroll", onScroll);
    cleanupForDOM.set(container, () => {
      container.removeEventListener("pointermove", onPointerOver);
      container.removeEventListener("focusin", onFocusIn);
      container.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("pointerleave", onPointerLeave);
      scroll.removeEventListener("scroll", onScroll);
      resizeObserver?.disconnect();
    });
  }

  private createCell(model: TableCellModel | undefined, row: number, column: number, editable: boolean): HTMLElement {
    const cell = document.createElement(row < 0 ? "th" : "td");
    const cellIndex = row < 0 ? column : this.table.headers.length + row * this.table.headers.length + column;
    cell.dataset.cellIndex = String(cellIndex);
    cell.dataset.rowIndex = String(row);
    cell.dataset.columnIndex = String(column);
    cell.dataset.sourceFrom = String(model?.from ?? this.table.from);
    cell.dataset.sourceTo = String(model?.to ?? this.table.from);
    cell.setAttribute("role", "gridcell");
    cell.setAttribute("aria-label", `${row < 0 ? "Header" : `Row ${row + 1}`}, column ${column + 1}`);
    cell.tabIndex = 0;
    renderCell(cell, model);

    if (editable) {
      cell.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        const container = cell.closest<HTMLElement>(".cm-table-widget-container");
        const view = container ? EditorView.findFromDOM(container) : null;
        const model = container && view ? currentTable(container, view) : undefined;
        const latestModel = model && sourceCell(model, Number(cell.dataset.rowIndex), Number(cell.dataset.columnIndex));
        if (!latestModel) return;
        event.preventDefault();
        const sourceOffset = pointSourceOffset(cell, event, latestModel);
        this.activateCell(cell, latestModel, sourceOffset, event.detail >= 2);
      });
      cell.addEventListener("focus", () => {
        if (cell.dataset.editing === "true") return;
        const container = cell.closest<HTMLElement>(".cm-table-widget-container");
        const view = container ? EditorView.findFromDOM(container) : null;
        const table = container && view ? currentTable(container, view) : undefined;
        const model = table && sourceCell(table, Number(cell.dataset.rowIndex), Number(cell.dataset.columnIndex));
        if (model) this.activateCell(cell, model, model.source.length, false);
      });
      cell.addEventListener("beforeinput", (event) => this.handleBeforeInput(cell, event));
      cell.addEventListener("input", () => this.persistCell(cell));
      cell.addEventListener("paste", (event) => this.handlePaste(cell, event));
      cell.addEventListener("keydown", (event) => this.handleCellKeydown(cell, event));
      cell.addEventListener("blur", () => {
        const container = cell.closest<HTMLElement>(".cm-table-widget-container");
        if (container?.dataset.rendering !== "true") this.finishCell(cell);
      });
    }
    return cell;
  }

  private getCell(row: number, column: number): TableCellModel | undefined {
    return sourceCell(this.table, row, column);
  }

  private activateCell(cell: HTMLElement, model: TableCellModel, sourceOffset: number, selectWord: boolean): void {
    if (cell.dataset.editing === "true") return;
    cell.dataset.originalSource = model.source;
    cell.dataset.editing = "true";
    cell.contentEditable = "true";
    cell.setAttribute("contenteditable", "true");
    cell.textContent = model.source;
    cell.focus({ preventScroll: true });
    const safeOffset = Math.max(0, Math.min(model.source.length, sourceOffset - model.from));
    if (selectWord) {
      const text = model.source;
      let start = safeOffset;
      let end = safeOffset;
      while (start > 0 && /[\p{L}\p{N}_]/u.test(text[start - 1])) start--;
      while (end < text.length && /[\p{L}\p{N}_]/u.test(text[end])) end++;
      selectTextRange(cell, start, end);
    } else {
      setCaret(cell, safeOffset);
    }
    const container = cell.closest<HTMLElement>(".cm-table-widget-container");
    const view = container ? EditorView.findFromDOM(container) : null;
    if (container) setActiveControls(container, Number(cell.dataset.rowIndex), Number(cell.dataset.columnIndex));
    if (view) {
      const selection = documentSelectionForCell(cell, model);
      view.dispatch({ selection, annotations: Transaction.addToHistory.of(false) });
      cell.dataset.originalSelectionAnchor = String(selection.anchor);
      cell.dataset.originalSelectionHead = String(selection.head);
    }
  }

  private handleBeforeInput(cell: HTMLElement, event: InputEvent): void {
    if (event.isComposing || !event.data || !["insertText", "insertReplacementText"].includes(event.inputType)) return;
    const text = cell.textContent ?? "";
    const range = cell.ownerDocument.getSelection()?.getRangeAt(0);
    if (!range || !cell.contains(range.startContainer) || !cell.contains(range.endContainer)) return;
    const from = textOffset(cell, range.startContainer, range.startOffset);
    const to = textOffset(cell, range.endContainer, range.endOffset);
    const edit = getDelimiterEdit(text, from, to, event.data);
    if (!edit) return;
    event.preventDefault();
    if (!edit.overtype) {
      this.commitCellDraft(cell, true);
      const updated = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
      cell.textContent = updated;
      setCaret(cell, edit.cursor);
      this.persistCell(cell);
      this.commitCellDraft(cell, true);
    } else {
      setCaret(cell, edit.cursor);
      this.persistCell(cell);
    }
  }

  private handlePaste(cell: HTMLElement, event: ClipboardEvent): void {
    event.preventDefault();
    this.commitCellDraft(cell, true, "input.type");
    const insertion = (event.clipboardData?.getData("text/plain") ?? "").replace(/[\r\n]+/g, " ");
    const text = cell.textContent ?? "";
    const range = cell.ownerDocument.getSelection()?.getRangeAt(0);
    if (!range || !cell.contains(range.startContainer) || !cell.contains(range.endContainer)) return;
    const from = textOffset(cell, range.startContainer, range.startOffset);
    const to = textOffset(cell, range.endContainer, range.endOffset);
    const next = text.slice(0, from) + insertion + text.slice(to);
    cell.textContent = next;
    setCaret(cell, from + insertion.length);
    this.persistCell(cell);
    this.commitCellDraft(cell, true, "input.type");
  }

  private handleCellKeydown(cell: HTMLElement, event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      cell.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cell.textContent = cell.dataset.originalSource ?? "";
      const container = cell.closest<HTMLElement>(".cm-table-widget-container");
      const view = container ? EditorView.findFromDOM(container) : null;
      const table = container && view ? currentTable(container, view) : undefined;
      const model = table ? sourceCell(table, Number(cell.dataset.rowIndex), Number(cell.dataset.columnIndex)) : undefined;
      if (model) {
        const anchor = Number(cell.dataset.originalSelectionAnchor ?? model.to);
        const head = Number(cell.dataset.originalSelectionHead ?? anchor);
        restoreCellSelection(cell, { ...model, to: model.from + (cell.textContent?.length ?? 0) }, anchor, head);
      }
      this.persistCell(cell);
      cell.blur();
    } else if (event.key === "Tab") {
      const container = cell.closest<HTMLElement>(".cm-table-widget-container");
      const cells = container ? Array.from(container.querySelectorAll<HTMLElement>("[data-cell-index]")) : [];
      const index = cells.indexOf(cell);
      const next = cells[index + (event.shiftKey ? -1 : 1)];
      if (next) {
        event.preventDefault();
        next.focus();
      }
    }
  }

  private finishCell(cell: HTMLElement): void {
    if (cell.dataset.editing !== "true") return;
    this.commitCellDraft(cell);
    cell.dataset.editing = "false";
    cell.contentEditable = "false";
    cell.setAttribute("contenteditable", "false");
    const container = cell.closest<HTMLElement>(".cm-table-widget-container");
    const view = container ? EditorView.findFromDOM(container) : null;
    const table = container && view ? currentTable(container, view) : undefined;
    const model = table && sourceCell(table, Number(cell.dataset.rowIndex), Number(cell.dataset.columnIndex));
    renderCell(cell, model);
    if (model) {
      cell.dataset.sourceFrom = String(model.from);
      cell.dataset.sourceTo = String(model.to);
    }
  }

  private persistCell(cell: HTMLElement): void {
    const container = cell.closest<HTMLElement>(".cm-table-widget-container");
    const view = container ? EditorView.findFromDOM(container) : null;
    if (!container || !view || view.state.facet(EditorState.readOnly)) return;
    const row = Number(cell.dataset.rowIndex);
    const column = Number(cell.dataset.columnIndex);
    const table = currentTable(container, view);
    const model = table && sourceCell(table, row, column);
    if (!model) return;
    const unnormalized = (cell.textContent ?? "").replace(/[\r\n]+/g, " ");
    const insert = normalizeTableCell(unnormalized);
    const activeRange = cell.ownerDocument.getSelection()?.getRangeAt(0);
    if (insert !== unnormalized && activeRange && cell.contains(activeRange.startContainer)) {
      const visibleOffset = textOffset(cell, activeRange.startContainer, activeRange.startOffset);
      cell.textContent = insert;
      setCaret(cell, normalizeTableCell(unnormalized.slice(0, visibleOffset)).length);
    }
    const editedModel = { ...model, to: model.from + insert.length };
    const selection = documentSelectionForCell(cell, editedModel);
    if (insert === model.source) {
      if (view.state.selection.main.anchor !== selection.anchor || view.state.selection.main.head !== selection.head) {
        view.dispatch({ selection, annotations: Transaction.addToHistory.of(false) });
      }
      return;
    }
    view.dispatch({
      changes: { from: model.from, to: model.to, insert },
      selection,
      annotations: [Transaction.addToHistory.of(false), Transaction.userEvent.of("input.type")],
    });
    cell.dataset.sourceFrom = String(model.from);
    cell.dataset.sourceTo = String(model.from + insert.length);
  }

  private commitCellDraft(cell: HTMLElement, isolate = true, userEvent = "input.type"): void {
    const container = cell.closest<HTMLElement>(".cm-table-widget-container");
    const view = container ? EditorView.findFromDOM(container) : null;
    if (!container || !view || view.state.facet(EditorState.readOnly)) return;
    const row = Number(cell.dataset.rowIndex);
    const column = Number(cell.dataset.columnIndex);
    const table = currentTable(container, view);
    const model = table && sourceCell(table, row, column);
    const original = cell.dataset.originalSource;
    if (!model || original === undefined) return;
    const current = normalizeTableCell((cell.textContent ?? "").replace(/[\r\n]+/g, " "));
    if (current === original || current !== model.source) return;

    const currentSelection = documentSelectionForCell(cell, { ...model, to: model.from + current.length });
    const baselineAnchor = Number(cell.dataset.originalSelectionAnchor ?? model.from);
    const baselineHead = Number(cell.dataset.originalSelectionHead ?? baselineAnchor);
    cell.dataset.historyCommit = "true";
    try {
      view.dispatch({
        changes: { from: model.from, to: model.to, insert: original },
        selection: { anchor: baselineAnchor, head: baselineHead },
        annotations: Transaction.addToHistory.of(false),
      });
      const restoredTable = currentTable(container, view);
      const restoredModel = restoredTable && sourceCell(restoredTable, row, column);
      if (!restoredModel) return;
      view.dispatch({
        changes: { from: restoredModel.from, to: restoredModel.to, insert: current },
        selection: currentSelection,
        annotations: [
          Transaction.userEvent.of(userEvent),
          ...(isolate ? [isolateHistory.of("full" as const)] : []),
        ],
      });
      cell.dataset.originalSource = current;
      cell.dataset.originalSelectionAnchor = String(currentSelection.anchor);
      cell.dataset.originalSelectionHead = String(currentSelection.head);
    } finally {
      delete cell.dataset.historyCommit;
    }
  }

  private handleHistoryShortcut(container: HTMLElement, event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const runRedo = key === "y" && !event.shiftKey || key === "z" && event.shiftKey;
    if (!runRedo && !(key === "z" && !event.shiftKey)) return;
    const view = EditorView.findFromDOM(container);
    if (!view) return;
    event.preventDefault();
    event.stopPropagation();

    const fallbackRow = Number(container.dataset.activeRow ?? -1);
    const fallbackColumn = Number(container.dataset.activeColumn ?? 0);
    const activeCell = document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>("[data-editing='true']")
      : null;
    if (activeCell && container.contains(activeCell)) this.commitCellDraft(activeCell, true);
    (runRedo ? redo : undo)(view);
    requestAnimationFrame(() => this.restoreFocus(container, view, fallbackRow, fallbackColumn));
  }

  private refreshCells(container: HTMLElement, view: EditorView, activeCell: HTMLElement): void {
    const cells = container.querySelectorAll<HTMLElement>("[data-cell-index]");
    for (const cell of cells) {
      const model = this.getCell(Number(cell.dataset.rowIndex), Number(cell.dataset.columnIndex));
      if (cell !== activeCell) renderCell(cell, model);
      cell.dataset.sourceFrom = String(model?.from ?? this.table.from);
      cell.dataset.sourceTo = String(model?.to ?? this.table.from);
      cell.style.textAlign = this.table.alignments[Number(cell.dataset.columnIndex)] ?? "left";
    }
    const activeModel = this.getCell(Number(activeCell.dataset.rowIndex), Number(activeCell.dataset.columnIndex));
    if (activeModel) {
      if (activeCell.textContent !== activeModel.source && activeCell.dataset.historyCommit !== "true") {
        activeCell.textContent = activeModel.source;
        restoreCellSelection(activeCell, activeModel, view.state.selection.main.anchor, view.state.selection.main.head);
        activeCell.dataset.originalSource = activeModel.source;
        activeCell.dataset.originalSelectionAnchor = String(view.state.selection.main.anchor);
        activeCell.dataset.originalSelectionHead = String(view.state.selection.main.head);
      }
      activeCell.dataset.sourceFrom = String(activeModel.from);
      activeCell.dataset.sourceTo = String(activeModel.to);
    }
    // A source edit may change a row height, so recalculate the floating controls.
    queueMicrotask(() => {
      if (container.isConnected) setActiveControls(container, Number(activeCell.dataset.rowIndex), Number(activeCell.dataset.columnIndex));
      view.requestMeasure();
    });
  }

  private restoreFocus(container: HTMLElement, view: EditorView, fallbackRow: number, fallbackColumn: number): void {
    if (!container.isConnected) return;
    const table = currentTable(container, view);
    if (!table) return;
    const position = view.state.selection.main.head;
    let targetRow = fallbackRow;
    let targetColumn = fallbackColumn;
    for (let row = -1; row < table.rows.length; row++) {
      const cells = row < 0 ? table.headers : table.rows[row];
      for (let column = 0; column < table.headers.length; column++) {
        const model = cells[column];
        if (model && position >= model.from && position <= model.to) {
          targetRow = row;
          targetColumn = column;
          break;
        }
      }
    }
    targetRow = targetRow < 0 ? -1 : Math.min(targetRow, table.rows.length - 1);
    targetColumn = Math.max(0, Math.min(targetColumn, table.headers.length - 1));
    const cell = container.querySelector<HTMLElement>(`[data-row-index="${targetRow}"][data-column-index="${targetColumn}"]`)
      ?? container.querySelector<HTMLElement>(`[data-row-index="-1"][data-column-index="${targetColumn}"]`);
    const model = cell && sourceCell(table, Number(cell.dataset.rowIndex), Number(cell.dataset.columnIndex));
    if (!cell || !model) return;
    cell.focus({ preventScroll: true });
    if (position >= model.from && position <= model.to) {
      restoreCellSelection(cell, model, view.state.selection.main.anchor, position);
    }
    setActiveControls(container, Number(cell.dataset.rowIndex), Number(cell.dataset.columnIndex));
  }

  private renderControls(container: HTMLElement, tableElement: HTMLTableElement): void {
    const rowLayer = document.createElement("div");
    rowLayer.className = "cm-table-row-control-layer";
    const addButton = (group: HTMLElement, label: string, action: () => void, disabled = false) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn-table-control";
      button.textContent = label.startsWith("+") ? "+" : "−";
      button.setAttribute("aria-label", label);
      button.disabled = disabled;
      button.addEventListener("mousedown", event => {
        // Keep an active cell's focus until the action runs. A blur can rebuild
        // this toolbar between pointerdown and click, dropping the action.
        event.preventDefault();
      });
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        action();
      });
      group.appendChild(button);
    };

    const rowCount = this.table.rows.length + 1;
    for (let row = -1; row < rowCount - 1; row++) {
      const group = document.createElement("div");
      group.className = "cm-table-control-group cm-table-row-control";
      group.dataset.rowControls = String(row);
      group.hidden = true;
      const rowLabel = row < 0 ? "header row" : `row ${row + 1}`;
      addButton(group, `+ Add row below ${rowLabel}`, () => this.changeRows(container, row, true));
      if (row >= 0) addButton(group, `− Delete row ${row + 1}`, () => this.changeRows(container, row, false));
      rowLayer.appendChild(group);
    }
    container.appendChild(rowLayer);

    for (let column = 0; column < this.table.headers.length; column++) {
      for (const edge of ["top", "bottom"] as const) {
        const group = document.createElement("div");
        group.className = `cm-table-control-group cm-table-column-control cm-table-column-control-${edge}`;
        group.dataset.columnControls = String(column);
        group.dataset.edge = edge;
        group.hidden = true;
        addButton(group, `+ Add column right of column ${column + 1}`, () => this.changeColumns(container, column, true));
        addButton(group, `− Delete column ${column + 1}`, () => this.changeColumns(container, column, false), this.table.headers.length <= 1);
        container.appendChild(group);
      }
    }
    tableElement.addEventListener("pointermove", (event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-row-index][data-column-index]") : null;
      if (target) setActiveControls(container, Number(target.dataset.rowIndex), Number(target.dataset.columnIndex));
    });
  }

  private changeRows(container: HTMLElement, row: number, insert: boolean): void {
    const view = EditorView.findFromDOM(container);
    if (!view) return;
    const table = currentTable(container, view);
    if (!table) return;
    const source = sourceData(table);
    let focusRow: number;
    if (insert) {
      focusRow = row + 1;
      source.rows.splice(focusRow, 0, Array(source.headers.length).fill(""));
    } else {
      source.rows.splice(row, 1);
      focusRow = Math.min(row, source.rows.length - 1);
    }
    this.replaceTable(view, table, source, focusRow, Math.max(0, Number(container.dataset.activeColumn) || 0));
  }

  private changeColumns(container: HTMLElement, column: number, insert: boolean): void {
    const view = EditorView.findFromDOM(container);
    if (!view) return;
    const table = currentTable(container, view);
    if (!table) return;
    const source = sourceData(table);
    let focusColumn = column;
    if (insert) {
      focusColumn = column + 1;
      source.headers.splice(focusColumn, 0, `Column ${focusColumn + 1}`);
      source.alignments.splice(focusColumn, 0, "left");
      source.rows.forEach((row) => row.splice(focusColumn, 0, ""));
    } else {
      if (source.headers.length <= 1) return;
      source.headers.splice(column, 1);
      source.alignments.splice(column, 1);
      source.rows.forEach((row) => row.splice(column, 1));
      focusColumn = Math.min(column, source.headers.length - 1);
    }
    this.replaceTable(view, table, source, Number(container.dataset.activeRow), focusColumn);
  }

  private replaceTable(view: EditorView, current: TableModel, source: TableSource, focusRow: number, focusColumn: number): void {
    const oldSource = view.state.doc.sliceString(current.from, current.to);
    const keepTrailingNewline = oldSource.endsWith("\n");
    const serialized = serializeTable(source) + (keepTrailingNewline ? "\n" : "");
    view.dispatch({
      changes: { from: current.from, to: current.to, insert: serialized },
      annotations: [Transaction.userEvent.of("input.table"), isolateHistory.of("full")],
    });
    requestAnimationFrame(() => {
      const container = view.dom.querySelector<HTMLElement>(`.cm-table-widget-container[data-source-from="${current.from}"]`);
      if (!container) return;
      const row = Math.min(focusRow, Number(container.querySelectorAll("tbody tr").length) - 1);
      const cell = container.querySelector<HTMLElement>(`[data-row-index="${row}"][data-column-index="${focusColumn}"]`)
        ?? container.querySelector<HTMLElement>(`[data-row-index="-1"][data-column-index="${focusColumn}"]`);
      cell?.focus({ preventScroll: true });
      cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (cell) setActiveControls(container, Number(cell.dataset.rowIndex), Number(cell.dataset.columnIndex));
    });
  }
}

function normalizeTableCell(source: string): string {
  let escaped = false;
  let codeTicks = 0;
  let output = "";
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === "`" && !escaped) {
      let end = index + 1;
      while (source[end] === "`") end++;
      const length = end - index;
      if (codeTicks === 0) codeTicks = length;
      else if (codeTicks === length) codeTicks = 0;
      output += source.slice(index, end);
      index = end - 1;
      escaped = false;
    } else if (character === "|" && !escaped && codeTicks === 0) {
      output += "\\|";
      escaped = false;
    } else {
      output += character;
      escaped = !escaped && character === "\\";
    }
  }
  return output;
}

function buildTableDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const table of findTables(state)) {
    builder.add(table.from, table.to, Decoration.replace({ widget: new TableWidget(table), block: true }));
  }
  return builder.finish();
}

const tableWidgetField = StateField.define<DecorationSet>({
  create: buildTableDecorations,
  update(decorations, transaction) {
    return transaction.docChanged || transaction.reconfigured
      ? buildTableDecorations(transaction.state)
      : decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const tableWidgetExtension: Extension = [
  tableWidgetField,
  EditorView.atomicRanges.of((view) => view.state.field(tableWidgetField, false) ?? Decoration.none),
];
