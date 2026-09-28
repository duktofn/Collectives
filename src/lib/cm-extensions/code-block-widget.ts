import { syntaxTree } from "@codemirror/language";
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
  keymap,
  type KeyBinding,
} from "@codemirror/view";
import {
  EditorSelection,
  Extension,
  Prec,
  RangeSetBuilder,
  StateField,
  EditorState,
} from "@codemirror/state";
import { highlightCodeAsync } from "./syntax-highlight";
import { editorModeFacet } from "./facet";

export function isChartFencedCode(state: EditorState, nodeFrom: number): boolean {
  return state.doc.lineAt(nodeFrom).text.trim().startsWith("```chart");
}

function fencedCodeAt(state: EditorState, head: number): { from: number; to: number } | null {
  const tree = syntaxTree(state);
  for (const side of [-1, 1] as const) {
    let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(head, side);
    while (node) {
      if (node.name === "FencedCode" && head >= node.from && head <= node.to) {
        return { from: node.from, to: node.to };
      }
      node = node.parent;
    }
  }
  return null;
}

export function isCursorInFencedCode(state: EditorState, head: number): boolean {
  return fencedCodeAt(state, head) !== null;
}

class CodeBlockWidget extends WidgetType {
  constructor(
    public codeText: string,
    public language: string,
    public from: number,
    public to: number,
    public innerFrom: number,
    public innerTo: number
  ) {
    super();
  }

  eq(other: CodeBlockWidget) {
    return (
      this.codeText === other.codeText &&
      this.language === other.language &&
      this.from === other.from &&
      this.to === other.to &&
      this.innerFrom === other.innerFrom &&
      this.innerTo === other.innerTo
    );
  }

  // .cm-codeblock-widget-container: margin 16*2 + padding 12*2 = 56px chrome
  // Code lines: ~22px each (mono 0.9em, line-height 1.5)
  get estimatedHeight() {
    const lineCount = Math.max(1, this.codeText.split("\n").length);
    return 56 + lineCount * 22;
  }

  private renderCode(code: HTMLElement) {
    const generation = String((Number(code.dataset.highlightGeneration) || 0) + 1);
    code.dataset.highlightGeneration = generation;
    code.textContent = this.codeText || " ";
    if (!this.language || this.codeText.length > 120_000) return;
    void highlightCodeAsync(this.codeText, this.language).then((html) => {
      if (code.isConnected && code.dataset.highlightGeneration === generation) {
        code.innerHTML = html || " ";
      }
    });
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    // The DOM listeners installed by toDOM capture this widget's source range.
    // Recreate the node after edits before it instead of keeping stale offsets.
    if (
      dom.getAttribute("data-source-from") !== String(this.from) ||
      dom.getAttribute("data-source-to") !== String(this.to)
    ) return false;
    const pre = dom.querySelector("pre");
    const code = dom.querySelector("code");
    if (pre && code) {
      this.renderCode(code);
      if (this.language) {
        code.setAttribute("data-lang", this.language);
      } else {
        code.removeAttribute("data-lang");
      }
    }
    // Update language badge
    const existingBadge = dom.querySelector(".cm-codeblock-lang-badge");
    if (this.language) {
      if (existingBadge) {
        existingBadge.textContent = this.language;
      } else {
        const badge = document.createElement("span");
        badge.className = "cm-codeblock-lang-badge";
        badge.textContent = this.language;
        dom.appendChild(badge);
      }
    } else if (existingBadge) {
      existingBadge.remove();
    }
    view.requestMeasure();
    return true;
  }

  toDOM(view: EditorView) {
    const container = document.createElement("div");
    container.className = "cm-codeblock-widget-container";
    container.setAttribute("data-source-from", String(this.from));
    container.setAttribute("data-source-to", String(this.to));
    container.setAttribute("role", "region");
    container.setAttribute("aria-label", this.language ? `${this.language} fenced code` : "Fenced code");
    container.style.position = "relative";

    let dragAnchor: number | null = null;
    const positionAtEvent = (event: MouseEvent): number | null => {
      const code = container.querySelector("code");
      const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY);
      if (code && caret && code.contains(caret.startContainer)) {
        try {
          const prefix = document.createRange();
          prefix.selectNodeContents(code);
          prefix.setEnd(caret.startContainer, caret.startOffset);
          return Math.min(this.innerTo, Math.max(this.innerFrom, this.innerFrom + prefix.toString().length));
        } catch {
          // Fall back to CodeMirror's nearest source boundary if browser caret mapping fails.
        }
      }
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (position === null) return null;
      return Math.min(this.innerTo, Math.max(this.innerFrom, position));
    };
    const updateSelection = (event: MouseEvent) => {
      const position = positionAtEvent(event);
      if (position === null) return;
      view.dispatch({
        selection: dragAnchor === null
          ? { anchor: position }
          : { anchor: dragAnchor, head: position },
      });
    };
    const stopDrag = () => {
      dragAnchor = null;
      document.removeEventListener("mousemove", moveDrag);
      document.removeEventListener("mouseup", stopDrag);
    };
    const moveDrag = (event: MouseEvent) => {
      if (dragAnchor !== null && event.buttons !== 0) updateSelection(event);
    };
    const startDrag = (event: MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const position = positionAtEvent(event);
      if (position === null) return;
      dragAnchor = position;
      view.focus();
      updateSelection(event);
      document.addEventListener("mousemove", moveDrag);
      document.addEventListener("mouseup", stopDrag);
    };
    container.addEventListener("mousedown", startDrag);
    container.addEventListener("mouseleave", stopDrag);

    const pre = document.createElement("pre");
    pre.className = "cm-codeblock-widget-pre";

    const code = document.createElement("code");
    this.renderCode(code);
    if (this.language) {
      code.setAttribute("data-lang", this.language);
    }

    pre.appendChild(code);
    container.appendChild(pre);

    if (this.language) {
      const badge = document.createElement("span");
      badge.className = "cm-codeblock-lang-badge";
      badge.textContent = this.language;
      container.appendChild(badge);
    }

    return container;
  }
}

function buildCodeBlockDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(state);
  const selection = state.selection.main;
  const mode = state.facet(editorModeFacet);

  tree.iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;

      if (isChartFencedCode(state, node.from)) return false;

      const isCursorInCodeBlock = mode !== "view"
        && selection.head >= node.from && selection.head <= node.to;

      const startLine = state.doc.lineAt(node.from);
      const endLine = state.doc.lineAt(node.to);
      const lineStart = startLine.number;
      const lineEnd = endLine.number;

      if (isCursorInCodeBlock) {
        for (let lineNumber = lineStart; lineNumber <= lineEnd; lineNumber++) {
          const line = state.doc.line(lineNumber);
          builder.add(
            line.from,
            line.from,
            Decoration.line({
              class:
                "cm-codeblock-line" +
                (lineNumber === lineStart ? " cm-codeblock-line-first" : "") +
                (lineNumber === lineEnd ? " cm-codeblock-line-last" : ""),
            })
          );
        }
        return false;
      }

      let codeText = "";
      if (lineEnd > lineStart + 1) {
        const innerFrom = state.doc.line(lineStart + 1).from;
        const innerTo = state.doc.line(lineEnd - 1).to;
        codeText = state.doc.sliceString(innerFrom, innerTo);
      }

      const langMatch = startLine.text.match(/^\s*(?:`{3,}|~{3,})([^\s`]*)/);
      const language = langMatch?.[1] || "";

      const innerFrom = lineEnd > lineStart + 1 ? state.doc.line(lineStart + 1).from : startLine.to;
      const innerTo = lineEnd > lineStart + 1 ? state.doc.line(lineEnd - 1).to : startLine.to;
      builder.add(
        node.from,
        node.to,
        Decoration.replace({
          widget: new CodeBlockWidget(codeText, language, node.from, node.to, innerFrom, innerTo),
          block: true,
        })
      );
      return false;
    },
  });

  return builder.finish();
}

const codeBlockWidgetField = StateField.define<DecorationSet>({
  create(state) {
    return buildCodeBlockDecorations(state);
  },
  update(decorations, tr) {
    if (tr.docChanged || tr.reconfigured) {
      return buildCodeBlockDecorations(tr.state);
    }
    if (tr.selection && tr.state.facet(editorModeFacet) !== "view") {
      const previousBlock = fencedCodeAt(tr.startState, tr.startState.selection.main.head);
      const nextBlock = fencedCodeAt(tr.state, tr.state.selection.main.head);
      if (previousBlock?.from !== nextBlock?.from || previousBlock?.to !== nextBlock?.to) {
        return buildCodeBlockDecorations(tr.state);
      }
    }
    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function codeBlockWidgetAt(
  state: EditorState,
  from: number,
  to: number,
  forward: boolean,
): { from: number; to: number; widget: CodeBlockWidget } | null {
  const decorations = state.field(codeBlockWidgetField, false);
  if (!decorations) return null;

  let candidate: { from: number; to: number; widget: CodeBlockWidget } | null = null;
  decorations.between(
    Math.max(0, from - 1),
    Math.min(state.doc.length, to + 1),
    (decorationFrom, decorationTo, decoration) => {
      const widget = decoration.spec.widget;
      if (!(widget instanceof CodeBlockWidget)) return;

      const isOnMovementPath = forward
        ? decorationFrom >= from && decorationFrom <= to + 1
        : decorationTo <= to && decorationTo >= from - 1;
      if (!isOnMovementPath) return;

      if (!candidate || (forward
        ? decorationFrom < candidate.from
        : decorationTo > candidate.to)) {
        candidate = { from: decorationFrom, to: decorationTo, widget };
      }
    },
  );
  return candidate;
}

function renderedCodeCaretPosition(
  view: EditorView,
  widget: CodeBlockWidget,
  goalColumn: number | undefined,
  forward: boolean,
): number | null {
  const container = view.dom.querySelector<HTMLElement>(
    `.cm-codeblock-widget-container[data-source-from="${widget.from}"][data-source-to="${widget.to}"]`,
  );
  const code = container?.querySelector<HTMLElement>("code");
  const codeRect = code?.getBoundingClientRect();
  if (code && codeRect && codeRect.height > 0) {
    const lineHeight = Number.parseFloat(getComputedStyle(code).lineHeight) || view.defaultLineHeight;
    const y = forward
      ? codeRect.top + Math.min(lineHeight / 2, codeRect.height / 2)
      : codeRect.bottom - Math.min(lineHeight / 2, codeRect.height / 2);
    const contentRect = view.contentDOM.getBoundingClientRect();
    const x = contentRect.left + (goalColumn ?? 0);
    const doc = code.ownerDocument;
    const caret = doc.caretRangeFromPoint?.(x, y) ?? (() => {
      const caretPositionFromPoint = (doc as Document & {
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      }).caretPositionFromPoint;
      const point = caretPositionFromPoint?.call(doc, x, y);
      if (!point) return null;
      const range = doc.createRange();
      range.setStart(point.offsetNode, point.offset);
      range.collapse(true);
      return range;
    })();

    if (caret && code.contains(caret.startContainer)) {
      try {
        const prefix = doc.createRange();
        prefix.selectNodeContents(code);
        prefix.setEnd(caret.startContainer, caret.startOffset);
        return Math.min(widget.innerTo, Math.max(widget.innerFrom, widget.innerFrom + prefix.toString().length));
      } catch {
        // Use the source-column fallback below when browser caret mapping fails.
      }
    }
  }

  const startLine = view.state.doc.lineAt(widget.from).number;
  const endLine = view.state.doc.lineAt(widget.to).number;
  const hasBodyLine = endLine > startLine + 1;
  if (!hasBodyLine) return widget.innerFrom;

  const targetLine = view.state.doc.line(forward ? startLine + 1 : endLine - 1);
  const column = Math.max(0, Math.round((goalColumn ?? 0) / view.defaultCharacterWidth));
  return Math.min(targetLine.to, targetLine.from + column);
}

function moveIntoRenderedCode(view: EditorView, forward: boolean, extend: boolean): boolean {
  if (view.state.facet(editorModeFacet) !== "edit-render") return false;

  const selection = view.state.selection.main;
  if (!selection.empty) return false;

  const moved = view.moveVertically(selection, forward);
  if (moved.head === selection.head) return false;

  const widgetRange = codeBlockWidgetAt(
    view.state,
    Math.min(selection.head, moved.head),
    Math.max(selection.head, moved.head),
    forward,
  );
  if (!widgetRange) return false;

  const position = renderedCodeCaretPosition(view, widgetRange.widget, moved.goalColumn, forward);
  if (position === null) return false;

  const nextSelection = extend
    ? EditorSelection.range(selection.anchor, position)
    : EditorSelection.cursor(position);
  view.dispatch({ selection: nextSelection, scrollIntoView: true });
  return true;
}

const renderedCodeVerticalKeymap: KeyBinding[] = [
  {
    key: "ArrowUp",
    preventDefault: true,
    run: (view) => moveIntoRenderedCode(view, false, false),
    shift: (view) => moveIntoRenderedCode(view, false, true),
  },
  {
    key: "ArrowDown",
    preventDefault: true,
    run: (view) => moveIntoRenderedCode(view, true, false),
    shift: (view) => moveIntoRenderedCode(view, true, true),
  },
];

export const codeBlockWidgetExtension: Extension = [
  codeBlockWidgetField,
  Prec.highest(keymap.of(renderedCodeVerticalKeymap)),
];
