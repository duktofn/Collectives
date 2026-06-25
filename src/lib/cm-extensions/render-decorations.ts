import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, Extension } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import { EmptyWidget } from "./empty-widget";
import {
  isChartFencedCode,
  isCursorInFencedCode,
} from "./code-block-widget";

interface DecSpec {
  from: number;
  to: number;
  value: Decoration;
}

class RenderPlugin {
  decorations: DecorationSet;
  atomic: DecorationSet;
  private lastLineFrom = -1;
  private lastInCodeBlock = false;

  constructor(view: EditorView) {
    const { decorations, atomic } = this.buildDecorations(view);
    this.decorations = decorations;
    this.atomic = atomic;
    const head = view.state.selection.main.head;
    this.lastLineFrom = view.state.doc.lineAt(head).from;
    this.lastInCodeBlock = isCursorInFencedCode(view.state, head);
  }

  private selectionAffectsDecorations(update: ViewUpdate): boolean {
    const head = update.state.selection.main.head;
    const lineFrom = update.state.doc.lineAt(head).from;
    const inCodeBlock = isCursorInFencedCode(update.state, head);
    const changed =
      lineFrom !== this.lastLineFrom || inCodeBlock !== this.lastInCodeBlock;
    this.lastLineFrom = lineFrom;
    this.lastInCodeBlock = inCodeBlock;
    return changed;
  }

  update(update: ViewUpdate) {
    const prevInCodeBlock = this.lastInCodeBlock;

    const shouldRebuild =
      update.docChanged ||
      update.viewportChanged ||
      update.transactions.some((tr) => tr.reconfigured) ||
      (update.selectionSet && this.selectionAffectsDecorations(update));

    if (shouldRebuild) {
      const { decorations, atomic } = this.buildDecorations(update.view);
      this.decorations = decorations;
      this.atomic = atomic;

      const head = update.state.selection.main.head;
      const inCodeBlock = isCursorInFencedCode(update.state, head);
      if (inCodeBlock !== prevInCodeBlock) {
        update.view.requestMeasure();
      }
    }
  }

  buildDecorations(view: EditorView): { decorations: DecorationSet; atomic: DecorationSet } {
    const decs: DecSpec[] = [];
    const atomicDecs: DecSpec[] = [];
    const tree = syntaxTree(view.state);
    const selection = view.state.selection.main;

    // Track which Link nodes contain the cursor
    const activeLinkNodes: { from: number; to: number }[] = [];

    // First pass: find active link nodes
    tree.iterate({
      enter(node) {
        if (node.name === "Link") {
          if (selection.head >= node.from && selection.head <= node.to) {
            activeLinkNodes.push({ from: node.from, to: node.to });
          }
        }
      },
    });

    const isCursorInLink = (from: number, to: number) => {
      return activeLinkNodes.some(
        (link) => from >= link.from && to <= link.to
      );
    };

    for (const { from, to } of view.visibleRanges) {
      tree.iterate({
        from,
        to,
        enter(node) {
          const name = node.name;
          const nodeFrom = node.from;
          const nodeTo = node.to;

          // Check if cursor is on the same line as this node
          const startLine = view.state.doc.lineAt(nodeFrom);
          const endLine = view.state.doc.lineAt(nodeTo);
          const isCursorInLine =
            selection.head >= startLine.from && selection.head <= endLine.to;

          // Headings
          if (name.startsWith("ATXHeading")) {
            const level = parseInt(name.replace("ATXHeading", "")) || 1;
            decs.push({
              from: nodeFrom,
              to: nodeFrom,
              value: Decoration.line({
                class: `cm-heading cm-heading-${level}`,
              }),
            });
          }

          // Heading HeaderMark (e.g. #, ##)
          if (name === "HeaderMark" && node.node.parent?.name.startsWith("ATXHeading")) {
            if (!isCursorInLine) {
              const lineEnd = view.state.doc.lineAt(nodeFrom).to;
              const maxTo = Math.min(nodeTo + 1, lineEnd);
              const val = Decoration.replace({
                widget: new EmptyWidget(),
              });
              decs.push({
                from: nodeFrom,
                to: maxTo, // include space after # safely
                value: val,
              });
              atomicDecs.push({
                from: nodeFrom,
                to: maxTo,
                value: val,
              });
            }
          }

          // Strong Emphasis (Bold)
          if (name === "StrongEmphasis") {
            decs.push({
              from: nodeFrom,
              to: nodeTo,
              value: Decoration.mark({
                class: "cm-strong",
              }),
            });

            if (!isCursorInLine) {
              // Hide the ** markers
              const val1 = Decoration.replace({ widget: new EmptyWidget() });
              const val2 = Decoration.replace({ widget: new EmptyWidget() });

              decs.push({
                from: nodeFrom,
                to: nodeFrom + 2,
                value: val1,
              });
              decs.push({
                from: nodeTo - 2,
                to: nodeTo,
                value: val2,
              });

              atomicDecs.push({
                from: nodeFrom,
                to: nodeFrom + 2,
                value: val1,
              });
              atomicDecs.push({
                from: nodeTo - 2,
                to: nodeTo,
                value: val2,
              });
            }
          }

          // Emphasis (Italic)
          if (name === "Emphasis") {
            decs.push({
              from: nodeFrom,
              to: nodeTo,
              value: Decoration.mark({
                class: "cm-emphasis",
              }),
            });

            if (!isCursorInLine) {
              // Hide the * markers
              const val1 = Decoration.replace({ widget: new EmptyWidget() });
              const val2 = Decoration.replace({ widget: new EmptyWidget() });

              decs.push({
                from: nodeFrom,
                to: nodeFrom + 1,
                value: val1,
              });
              decs.push({
                from: nodeTo - 1,
                to: nodeTo,
                value: val2,
              });

              atomicDecs.push({
                from: nodeFrom,
                to: nodeFrom + 1,
                value: val1,
              });
              atomicDecs.push({
                from: nodeTo - 1,
                to: nodeTo,
                value: val2,
              });
            }
          }

          // Inline Code
          if (name === "InlineCode") {
            decs.push({
              from: nodeFrom,
              to: nodeTo,
              value: Decoration.mark({
                class: "cm-inline-code",
              }),
            });

            if (!isCursorInLine) {
              // Hide backticks
              const val1 = Decoration.replace({ widget: new EmptyWidget() });
              const val2 = Decoration.replace({ widget: new EmptyWidget() });

              decs.push({
                from: nodeFrom,
                to: nodeFrom + 1,
                value: val1,
              });
              decs.push({
                from: nodeTo - 1,
                to: nodeTo,
                value: val2,
              });

              atomicDecs.push({
                from: nodeFrom,
                to: nodeFrom + 1,
                value: val1,
              });
              atomicDecs.push({
                from: nodeTo - 1,
                to: nodeTo,
                value: val2,
              });
            }
          }

          // Link styling
          if (name === "LinkLabel") {
            decs.push({
              from: nodeFrom,
              to: nodeTo,
              value: Decoration.mark({
                class: "cm-link-text",
              }),
            });

            if (!isCursorInLink(nodeFrom, nodeTo)) {
              // Hide brackets
              const val1 = Decoration.replace({ widget: new EmptyWidget() });
              const val2 = Decoration.replace({ widget: new EmptyWidget() });

              decs.push({
                from: nodeFrom,
                to: nodeFrom + 1,
                value: val1,
              });
              decs.push({
                from: nodeTo - 1,
                to: nodeTo,
                value: val2,
              });

              atomicDecs.push({
                from: nodeFrom,
                to: nodeFrom + 1,
                value: val1,
              });
              atomicDecs.push({
                from: nodeTo - 1,
                to: nodeTo,
                value: val2,
              });
            }
          }

          if (name === "LinkResource") {
            if (!isCursorInLink(nodeFrom, nodeTo)) {
              // Hide the (url) part
              const val = Decoration.replace({ widget: new EmptyWidget() });

              decs.push({
                from: nodeFrom,
                to: nodeTo,
                value: val,
              });

              atomicDecs.push({
                from: nodeFrom,
                to: nodeTo,
                value: val,
              });
            }
          }

          // FencedCode — preview widget when cursor outside; source view when inside
          if (name === "FencedCode") {
            if (isChartFencedCode(view.state, nodeFrom)) {
              return false;
            }

            const startLine = view.state.doc.lineAt(nodeFrom);
            const endLine = view.state.doc.lineAt(nodeTo);
            const lineStart = startLine.number;
            const lineEnd = endLine.number;

            const isCursorInCodeBlock =
              selection.head >= nodeFrom && selection.head <= nodeTo;

            if (!isCursorInCodeBlock) {
              return false;
            }

            for (let i = lineStart; i <= lineEnd; i++) {
              const line = view.state.doc.line(i);
              decs.push({
                from: line.from,
                to: line.from,
                value: Decoration.line({
                  class:
                    "cm-codeblock-line" +
                    (i === lineStart ? " cm-codeblock-line-first" : "") +
                    (i === lineEnd ? " cm-codeblock-line-last" : ""),
                }),
              });
            }
            return false;
          }

          // Blockquotes
          if (name === "Blockquote") {
            // Apply line decoration to every line in the blockquote
            const lineStart = view.state.doc.lineAt(nodeFrom).number;
            const lineEnd = view.state.doc.lineAt(nodeTo).number;
            for (let i = lineStart; i <= lineEnd; i++) {
              const line = view.state.doc.line(i);
              decs.push({
                from: line.from,
                to: line.from,
                value: Decoration.line({
                  class: "cm-blockquote-line",
                }),
              });
            }
          }

          // Horizontal Rule
          if (name === "HorizontalRule") {
            decs.push({
              from: nodeFrom,
              to: nodeTo,
              value: Decoration.mark({
                class: "cm-hr",
              }),
            });
          }
        },
      });
    }

    // Sort decorations: by 'from' ascending, then by 'startSide' ascending, then by 'to' descending
    decs.sort((a, b) => {
      if (a.from !== b.from) return a.from - b.from;
      if (a.value.startSide !== b.value.startSide) {
        return a.value.startSide - b.value.startSide;
      }
      return b.to - a.to;
    });

    atomicDecs.sort((a, b) => {
      if (a.from !== b.from) return a.from - b.from;
      if (a.value.startSide !== b.value.startSide) {
        return a.value.startSide - b.value.startSide;
      }
      return b.to - a.to;
    });

    const builder = new RangeSetBuilder<Decoration>();
    const atomicBuilder = new RangeSetBuilder<Decoration>();
    let lastFrom = -1;
    let lastTo = -1;

    for (const dec of decs) {
      if (dec.from >= lastFrom) {
        const isReplacement = dec.value.spec.widget !== undefined;
        if (isReplacement && dec.from < lastTo) {
          continue;
        }

        builder.add(dec.from, dec.to, dec.value);
        if (isReplacement) {
          lastTo = dec.to;
        }
        lastFrom = dec.from;
      }
    }

    lastFrom = -1;
    lastTo = -1;
    for (const dec of atomicDecs) {
      if (dec.from >= lastFrom) {
        const isReplacement = dec.value.spec.widget !== undefined;
        if (isReplacement && dec.from < lastTo) {
          continue;
        }

        if (isReplacement) {
          atomicBuilder.add(dec.from, dec.to, dec.value);
          lastTo = dec.to;
        }
        lastFrom = dec.from;
      }
    }

    return {
      decorations: builder.finish(),
      atomic: atomicBuilder.finish(),
    };
  }
}

const renderPlugin = ViewPlugin.fromClass(RenderPlugin, {
  decorations: (v) => v.decorations,
});

export const renderDecorationsExtension: Extension = [
  renderPlugin,
  EditorView.atomicRanges.of((view) => {
    const plugin = view.plugin(renderPlugin);
    return plugin ? plugin.atomic : Decoration.none;
  }),
];
