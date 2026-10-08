import type { BlockContext, LeafBlock, LeafBlockParser, Line, MarkdownConfig } from "@lezer/markdown";

function scanRow(
  line: string,
  start: number,
  offset: number,
  cx: BlockContext,
  elements?: ReturnType<BlockContext["elt"]>[],
): number {
  let count = 0;
  let cellStart = -1;
  let cellEnd = -1;
  let cellSegmentStart = start;
  let first = true;
  let escaped = false;
  let codeTicks = 0;
  const flushCell = (emptyPosition?: number) => {
    if (elements && cellStart >= 0) {
      elements.push(cx.elt(
        "TableCell",
        offset + cellStart,
        offset + cellEnd,
        cx.parser.parseInline(line.slice(cellStart, cellEnd), offset + cellStart),
      ));
    } else if (elements && emptyPosition !== undefined) {
      elements.push(cx.elt("TableCell", emptyPosition, emptyPosition));
    }
  };

  for (let index = start; index < line.length; index++) {
    const character = line.charCodeAt(index);
    if (character === 96 && !escaped) {
      let runEnd = index + 1;
      while (line.charCodeAt(runEnd) === 96) runEnd++;
      const runLength = runEnd - index;
      if (codeTicks === 0) codeTicks = runLength;
      else if (codeTicks === runLength) codeTicks = 0;
      if (cellStart < 0) cellStart = index;
      cellEnd = runEnd;
      index = runEnd - 1;
      escaped = false;
      continue;
    }
    if (character === 124 && !escaped && codeTicks === 0) {
      const hasCellBefore = !first || cellStart >= 0;
      if (hasCellBefore) count++;
      first = false;
      if (hasCellBefore) {
        const emptyPosition = offset + Math.floor((cellSegmentStart + index) / 2);
        flushCell(emptyPosition);
      }
      if (elements) elements.push(cx.elt("TableDelimiter", offset + index, offset + index + 1));
      cellStart = cellEnd = -1;
      cellSegmentStart = index + 1;
    } else if (escaped || (character !== 32 && character !== 9)) {
      if (cellStart < 0) cellStart = index;
      cellEnd = index + 1;
    }
    escaped = !escaped && character === 92;
  }
  if (cellStart >= 0) {
    count++;
    flushCell();
  }
  return count;
}

function hasPipeOutsideCode(line: string, start: number): boolean {
  let codeTicks = 0;
  let escaped = false;
  for (let index = start; index < line.length; index++) {
    const character = line.charCodeAt(index);
    if (character === 96 && !escaped) {
      let runEnd = index + 1;
      while (line.charCodeAt(runEnd) === 96) runEnd++;
      const runLength = runEnd - index;
      if (codeTicks === 0) codeTicks = runLength;
      else if (codeTicks === runLength) codeTicks = 0;
      index = runEnd - 1;
      escaped = false;
      continue;
    }
    if (character === 124 && !escaped && codeTicks === 0) return true;
    escaped = !escaped && character === 92;
  }
  return false;
}

const delimiterLine = /^\|?(\s*:?-+:?\s*\|)+(\s*:?-+:?\s*)?$/;

class TableLeafParser implements LeafBlockParser {
  private rows: ReturnType<BlockContext["elt"]>[] | false | null = null;

  nextLine(cx: BlockContext, line: Line, leaf: LeafBlock): boolean {
    if (this.rows === null) {
      this.rows = false;
      const lineText = line.text.slice(line.pos);
      if ((line.next === 45 || line.next === 58 || line.next === 124) && delimiterLine.test(lineText)) {
        const header: ReturnType<BlockContext["elt"]>[] = [];
        const headerCount = scanRow(leaf.content, 0, leaf.start, cx, header);
        if (headerCount === scanRow(lineText, 0, cx.lineStart + line.pos, cx)) {
          this.rows = [
            cx.elt("TableHeader", leaf.start, leaf.start + leaf.content.length, header),
            cx.elt("TableDelimiter", cx.lineStart + line.pos, cx.lineStart + line.text.length),
          ];
        }
      }
    } else if (this.rows) {
      const cells: ReturnType<BlockContext["elt"]>[] = [];
      scanRow(line.text, line.pos, cx.lineStart, cx, cells);
      this.rows.push(cx.elt("TableRow", cx.lineStart + line.pos, cx.lineStart + line.text.length, cells));
    }
    return false;
  }

  finish(cx: BlockContext, leaf: LeafBlock): boolean {
    if (!this.rows) return false;
    cx.addLeafElement(leaf, cx.elt("Table", leaf.start, leaf.start + leaf.content.length, this.rows));
    return true;
  }
}

/** GFM table parsing that treats a pipe inside a matched code span as cell text. */
export const tableMarkdownExtension: MarkdownConfig = {
  defineNodes: [
    { name: "Table", block: true },
    { name: "TableHeader" },
    "TableRow",
    { name: "TableCell" },
    { name: "TableDelimiter" },
  ],
  parseBlock: [{
    name: "Table",
    leaf(_cx, leaf) { return hasPipeOutsideCode(leaf.content, 0) ? new TableLeafParser() : null; },
    endLeaf(cx, line, _leaf) {
      if (!hasPipeOutsideCode(line.text, line.basePos)) return false;
      const nextLine = cx.peekLine();
      return delimiterLine.test(nextLine)
        && scanRow(line.text, line.basePos, 0, cx) === scanRow(nextLine, line.basePos, 0, cx);
    },
    before: "SetextHeading",
  }],
};
