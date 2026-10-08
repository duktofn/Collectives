import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

export type TableAlignment = "left" | "center" | "right";

export interface InlineTableNode {
  kind: "text" | "escape" | "code" | "emphasis" | "strong";
  text: string;
  from: number;
  to: number;
  children?: InlineTableNode[];
}

export interface TableCellModel {
  source: string;
  from: number;
  to: number;
  inline: InlineTableNode[];
}

export interface TableModel {
  from: number;
  to: number;
  source: string;
  headers: TableCellModel[];
  rows: TableCellModel[][];
  alignments: TableAlignment[];
}

function childNodes(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) children.push(child);
  return children;
}

function inlineRange(state: EditorState, parent: SyntaxNode, from: number, to: number): InlineTableNode[] {
  const nodes: InlineTableNode[] = [];
  let cursor = from;
  const appendText = (start: number, end: number) => {
    if (start >= end) return;
    nodes.push({ kind: "text", text: state.doc.sliceString(start, end), from: start, to: end });
  };

  for (const child of childNodes(parent)) {
    if (child.to <= from || child.from >= to || child.name === "EmphasisMark" || child.name === "CodeMark") continue;
    const start = Math.max(cursor, child.from, from);
    const end = Math.min(child.to, to);
    appendText(cursor, start);
    if (end <= start) continue;

    if (child.name === "Escape") {
      const source = state.doc.sliceString(start, end);
      nodes.push({ kind: "escape", text: source.startsWith("\\") ? source.slice(1) : source, from: start, to: end });
    } else if (child.name === "InlineCode") {
      const marks = childNodes(child).filter((node) => node.name === "CodeMark");
      const contentFrom = marks.length ? marks[0].to : child.from;
      const contentTo = marks.length > 1 ? marks[marks.length - 1].from : child.to;
      nodes.push({ kind: "code", text: state.doc.sliceString(contentFrom, contentTo), from: contentFrom, to: contentTo });
    } else if (child.name === "StrongEmphasis" || child.name === "Emphasis") {
      const marks = childNodes(child).filter((node) => node.name === "EmphasisMark");
      const contentFrom = marks.length ? marks[0].to : child.from;
      const contentTo = marks.length > 1 ? marks[marks.length - 1].from : child.to;
      nodes.push({
        kind: child.name === "StrongEmphasis" ? "strong" : "emphasis",
        text: "",
        from: contentFrom,
        to: contentTo,
        children: inlineRange(state, child, contentFrom, contentTo),
      });
    } else {
      appendText(start, end);
    }
    cursor = end;
  }
  appendText(cursor, to);
  return nodes;
}

function readCells(state: EditorState, row: SyntaxNode): TableCellModel[] {
  return childNodes(row)
    .filter((node) => node.name === "TableCell")
    .map((node) => ({
      source: state.doc.sliceString(node.from, node.to),
      from: node.from,
      to: node.to,
      inline: inlineRange(state, node, node.from, node.to),
    }));
}

function parseAlignments(state: EditorState, separator: SyntaxNode, columnCount: number): TableAlignment[] {
  const line = state.doc.lineAt(separator.from).text;
  const cells = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|");
  return Array.from({ length: columnCount }, (_, index) => {
    const cell = (cells[index] ?? "---").trim();
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    return left && right ? "center" : right ? "right" : "left";
  });
}

export function findTables(state: EditorState): TableModel[] {
  const tables: TableModel[] = [];
  syntaxTree(state).iterate({
    enter(nodeRef) {
      const node = nodeRef.node;
      if (node.name !== "Table") return;
      let header: SyntaxNode | null = null;
      let separator: SyntaxNode | null = null;
      const rows: SyntaxNode[] = [];
      for (const child of childNodes(node)) {
        if (child.name === "TableHeader") header = child;
        else if (child.name === "TableDelimiter") separator = child;
        else if (child.name === "TableRow") rows.push(child);
      }
      if (!header || !separator) return false;
      const headers = readCells(state, header);
      if (headers.length === 0) return false;
      tables.push({
        from: node.from,
        to: node.to,
        source: state.doc.sliceString(node.from, node.to).replace(/\n$/, ""),
        headers,
        rows: rows.map((row) => readCells(state, row)),
        alignments: parseAlignments(state, separator, headers.length),
      });
      return false;
    },
  });
  return tables;
}

export interface TableSource {
  headers: string[];
  rows: string[][];
  alignments: TableAlignment[];
}

function escapeUnescapedPipes(source: string): string {
  let result = "";
  let escaped = false;
  let codeTicks = 0;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === "`" && !escaped) {
      let end = index + 1;
      while (source[end] === "`") end++;
      const length = end - index;
      if (codeTicks === 0) codeTicks = length;
      else if (codeTicks === length) codeTicks = 0;
      result += source.slice(index, end);
      index = end - 1;
      escaped = false;
    } else if (character === "|" && !escaped && codeTicks === 0) {
      result += "\\|";
      escaped = false;
    } else {
      result += character;
      escaped = !escaped && character === "\\";
    }
  }
  return result;
}

export function serializeTable(source: TableSource): string {
  const columns = Math.max(1, source.headers.length);
  const headers = source.headers.slice(0, columns);
  const alignments = source.alignments.slice(0, columns);
  while (headers.length < columns) headers.push("");
  while (alignments.length < columns) alignments.push("left");
  const formatRow = (cells: string[]) => `| ${Array.from({ length: columns }, (_, index) => escapeUnescapedPipes(cells[index] ?? "")).join(" | ")} |`;
  const separator = `| ${alignments.map((alignment) => alignment === "center" ? ":---:" : alignment === "right" ? "---:" : ":---").join(" | ")} |`;
  return [formatRow(headers), separator, ...source.rows.map((row) => formatRow(row))].join("\n");
}
