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

interface DecSpec {
  from: number;
  to: number;
  value: Decoration;
}

class RenderPlugin {
  decorations: DecorationSet;
  atomic: DecorationSet;

  constructor(view: EditorView) {
    const { decorations, atomic } = this.buildDecorations(view);
    this.decorations = decorations;
    this.atomic = atomic;
  }

  update(update: ViewUpdate) {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      update.transactions.some(tr => tr.reconfigured)
    ) {
      const { decorations, atomic } = this.buildDecorations(update.view);
      this.decorations = decorations;
      this.atomic = atomic;
    }
  }

  buildDecorations(view: EditorView): { decorations: DecorationSet; atomic: DecorationSet } {
    const decs: DecSpec[] = [];
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
              const maxTo = Math.min(nodeTo + 1, view.state.doc.length);
              decs.push({
                from: nodeFrom,
                to: maxTo, // include space after # safely
                value: Decoration.replace({
                  widget: new EmptyWidget(),
                }),
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

            // Hide the ** markers if cursor is not in line
            if (!isCursorInLine) {
              decs.push({
                from: nodeFrom,
                to: nodeFrom + 2,
                value: Decoration.replace({ widget: new EmptyWidget() }),
              });
              decs.push({
                from: nodeTo - 2,
                to: nodeTo,
                value: Decoration.replace({ widget: new EmptyWidget() }),
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

            // Hide the * markers if cursor is not in line
            if (!isCursorInLine) {
              decs.push({
                from: nodeFrom,
                to: nodeFrom + 1,
                value: Decoration.replace({ widget: new EmptyWidget() }),
              });
              decs.push({
                from: nodeTo - 1,
                to: nodeTo,
                value: Decoration.replace({ widget: new EmptyWidget() }),
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

            // Hide backticks if cursor is not in line
            if (!isCursorInLine) {
              decs.push({
                from: nodeFrom,
                to: nodeFrom + 1,
                value: Decoration.replace({ widget: new EmptyWidget() }),
              });
              decs.push({
                from: nodeTo - 1,
                to: nodeTo,
                value: Decoration.replace({ widget: new EmptyWidget() }),
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

            // Hide brackets if cursor is not in the Link node
            if (!isCursorInLink(nodeFrom, nodeTo)) {
              decs.push({
                from: nodeFrom,
                to: nodeFrom + 1,
                value: Decoration.replace({ widget: new EmptyWidget() }),
              });
              decs.push({
                from: nodeTo - 1,
                to: nodeTo,
                value: Decoration.replace({ widget: new EmptyWidget() }),
              });
            }
          }

          if (name === "LinkResource") {
            // Hide the (url) part if cursor is not in the Link node
            if (!isCursorInLink(nodeFrom, nodeTo)) {
              decs.push({
                from: nodeFrom,
                to: nodeTo,
                value: Decoration.replace({ widget: new EmptyWidget() }),
              });
            }
          }
          // FencedCode
          if (name === "FencedCode") {
            const startLine = view.state.doc.lineAt(nodeFrom);
            const endLine = view.state.doc.lineAt(nodeTo);
            const lineStart = startLine.number;
            const lineEnd = endLine.number;

            // Check if selection is anywhere inside the fenced code block (inclusive of the fences)
            const isCursorInCodeBlock = selection.head >= nodeFrom && selection.head <= nodeTo;

            if (isCursorInCodeBlock) {
              // The cursor is inside the code block. Show all lines, including fences.
              for (let i = lineStart; i <= lineEnd; i++) {
                const line = view.state.doc.line(i);
                decs.push({
                  from: line.from,
                  to: line.from,
                  value: Decoration.line({
                    class: "cm-codeblock-line" + 
                      (i === lineStart ? " cm-codeblock-line-first" : "") + 
                      (i === lineEnd ? " cm-codeblock-line-last" : ""),
                  }),
                });
              }
            } else {
              // The cursor is outside the code block. Hide opening and closing fences.
              decs.push({
                from: startLine.from,
                to: startLine.to,
                value: Decoration.replace({ widget: new EmptyWidget() }),
              });
              decs.push({
                from: startLine.from,
                to: startLine.from,
                value: Decoration.line({ class: "cm-codeblock-fence-hidden" }),
              });

              decs.push({
                from: endLine.from,
                to: endLine.to,
                value: Decoration.replace({ widget: new EmptyWidget() }),
              });
              decs.push({
                from: endLine.from,
                to: endLine.from,
                value: Decoration.line({ class: "cm-codeblock-fence-hidden" }),
              });

              // Style the inner lines of code.
              for (let i = lineStart + 1; i <= lineEnd - 1; i++) {
                const line = view.state.doc.line(i);
                decs.push({
                  from: line.from,
                  to: line.from,
                  value: Decoration.line({
                    class: "cm-codeblock-line" + 
                      (i === lineStart + 1 ? " cm-codeblock-line-first" : "") + 
                      (i === lineEnd - 1 ? " cm-codeblock-line-last" : ""),
                  }),
                });
              }
            }
            return false; // skip children
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
