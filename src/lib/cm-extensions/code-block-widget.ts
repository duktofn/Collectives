import { syntaxTree } from "@codemirror/language";
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder, StateField, EditorState, Extension } from "@codemirror/state";

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
    public to: number
  ) {
    super();
  }

  eq(other: CodeBlockWidget) {
    return (
      this.codeText === other.codeText &&
      this.language === other.language &&
      this.from === other.from &&
      this.to === other.to
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
      code.textContent = this.codeText || " ";
      if (this.language) {
        code.setAttribute("data-lang", this.language);
      } else {
        code.removeAttribute("data-lang");
      }
    }
    view.requestMeasure();
    return true;
  }

  toDOM(_view: EditorView) {
    const container = document.createElement("div");
    container.className = "cm-codeblock-widget-container";

    const pre = document.createElement("pre");
    pre.className = "cm-codeblock-widget-pre";

    const code = document.createElement("code");
    code.textContent = this.codeText || " ";
    if (this.language) {
      code.setAttribute("data-lang", this.language);
    }

    pre.appendChild(code);
    container.appendChild(pre);
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
      if (isCursorInCodeBlock) return false;

      const startLine = state.doc.lineAt(node.from);
      const endLine = state.doc.lineAt(node.to);
      const lineStart = startLine.number;
      const lineEnd = endLine.number;

      let codeText = "";
      if (lineEnd > lineStart + 1) {
        const innerFrom = state.doc.line(lineStart + 1).from;
        const innerTo = state.doc.line(lineEnd - 1).to;
        codeText = state.doc.sliceString(innerFrom, innerTo);
      }

      const langMatch = startLine.text.match(/^```(\w*)/);
      const language = langMatch?.[1] || "";

      builder.add(
        node.from,
        node.to,
        Decoration.replace({
          widget: new CodeBlockWidget(codeText, language, node.from, node.to),
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
  EditorView.atomicRanges.of((view) => {
    return view.state.field(codeBlockWidgetField, false) ?? Decoration.none;
  }),
];
