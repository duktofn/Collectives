import { syntaxTree } from "@codemirror/language";
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder, StateField, EditorState, Extension } from "@codemirror/state";
import { highlightCode } from "./syntax-highlight";

export function isChartFencedCode(state: EditorState, nodeFrom: number): boolean {
  return state.doc.lineAt(nodeFrom).text.trim().startsWith("```chart");
}

export function isCursorInFencedCode(state: EditorState, head: number): boolean {
  const tree = syntaxTree(state);
  let inside = false;
  tree.iterate({
    enter(node) {
      if (node.name === "FencedCode") {
        if (head >= node.from && head <= node.to) {
          inside = true;
          return false;
        }
      }
    },
  });
  return inside;
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

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const pre = dom.querySelector("pre");
    const code = dom.querySelector("code");
    if (pre && code) {
      code.innerHTML = highlightCode(this.codeText, this.language) || " ";
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
    code.innerHTML = highlightCode(this.codeText, this.language) || " ";
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

  tree.iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;

      if (isChartFencedCode(state, node.from)) return false;

      const isCursorInCodeBlock =
        selection.head >= node.from && selection.head <= node.to;

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

      const langMatch = startLine.text.match(/^```(\w*)/);
      const language = langMatch?.[1] || "";

      const innerFrom = lineEnd > lineStart + 1 ? state.doc.line(lineStart + 1).from : startLine.to;
      const innerTo = lineEnd > lineStart + 1 ? state.doc.line(lineEnd - 1).to : startLine.to;
      if (innerTo <= innerFrom) return false;
      builder.add(
        innerFrom,
        innerTo,
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
    if (tr.docChanged || tr.selection) {
      return buildCodeBlockDecorations(tr.state);
    }
    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const codeBlockWidgetExtension: Extension = [
  codeBlockWidgetField,
];
