import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, Extension } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { EmptyWidget } from './empty-widget';
import { inlineClasses, inlineFormattingAt } from './inline-formatting';

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
    const shouldRebuild =
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      syntaxTree(update.startState) !== syntaxTree(update.state) ||
      update.transactions.some((tr) => tr.reconfigured);

    if (shouldRebuild) {
      const { decorations, atomic } = this.buildDecorations(update.view);
      this.decorations = decorations;
      this.atomic = atomic;
    }
  }

  buildDecorations(view: EditorView): { decorations: DecorationSet; atomic: DecorationSet } {
    const decs: DecSpec[] = [];
    const atomicDecs: DecSpec[] = [];
    const tree = syntaxTree(view.state);
    const editable = view.state.facet(EditorView.editable) && !view.state.readOnly;
    const isActive = (from: number, to: number) => editable &&
      view.state.selection.ranges.some((range) => range.empty
        // Keep the closing boundary visible so native input has a real DOM
        // position after the delimiter, including at the end of the document.
        ? range.head > from && range.head <= to
        : range.from < to && range.to > from);

    if (editable) {
      const drafts = new Set<string>();
      for (const range of view.state.selection.ranges) {
        for (const span of inlineFormattingAt(view.state, range.head)) {
          const key = `${span.name}:${span.from}:${span.to}`;
          if (!span.draft || drafts.has(key)) continue;
          drafts.add(key);
          decs.push({ from: span.from, to: span.to, value: Decoration.mark({ class: inlineClasses[span.name] }) });
        }
      }
    }

    for (const { from, to } of view.visibleRanges) {
      tree.iterate({
        from,
        to,
        enter(node) {
          const name = node.name;
          const nodeFrom = node.from;
          const nodeTo = node.to;

          // Headings
          if (name.startsWith('ATXHeading')) {
            const level = parseInt(name.replace('ATXHeading', '')) || 1;
            decs.push({
              from: nodeFrom,
              to: nodeFrom,
              value: Decoration.line({
                class: `cm-heading cm-heading-${level}`,
              }),
            });
          }

          // Heading HeaderMark (e.g. #, ##)
          if (name === 'HeaderMark' && node.node.parent?.name.startsWith('ATXHeading')) {
            const line = view.state.doc.lineAt(nodeFrom);
            // Hiding an empty heading removes its entire editable DOM range.
            // Native input then lands before the marker instead of after it.
            if (view.state.facet(EditorView.editable) && /^ {0,3}#{1,6}[\t #]*$/.test(line.text))
              return;
            const lineEnd = line.to;
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

          // Keep inline styling while exposing the active span's real delimiters.
          const inlineClass = inlineClasses[name];
          if (inlineClass) {
            decs.push({
              from: nodeFrom,
              to: nodeTo,
              value: Decoration.mark({ class: inlineClass }),
            });

            if (!isActive(nodeFrom, nodeTo)) {
              // Parser marks also cover __bold__, nested emphasis, and multi-backtick code.
              for (let child = node.node.firstChild; child; child = child.nextSibling) {
                if (!['EmphasisMark', 'CodeMark', 'StrikethroughMark'].includes(child.name)) continue;
                const dec = {
                  from: child.from,
                  to: child.to,
                  value: Decoration.replace({ widget: new EmptyWidget() }),
                };
                decs.push(dec);
                atomicDecs.push(dec);
              }
            }
          }

          // Link styling
          if (name === 'LinkLabel') {
            decs.push({
              from: nodeFrom,
              to: nodeTo,
              value: Decoration.mark({
                class: 'cm-link-text',
              }),
            });

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

          if (name === 'LinkResource') {
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

          // Blockquotes
          if (name === 'Blockquote') {
            // Apply line decoration to every line in the blockquote
            const lineStart = view.state.doc.lineAt(nodeFrom).number;
            const lineEnd = view.state.doc.lineAt(nodeTo).number;
            for (let i = lineStart; i <= lineEnd; i++) {
              const line = view.state.doc.line(i);
              decs.push({
                from: line.from,
                to: line.from,
                value: Decoration.line({
                  class: 'cm-blockquote-line',
                }),
              });
            }
          }

          // Horizontal Rule
          if (name === 'HorizontalRule') {
            // Empty **|** / __|__ pairs parse as rules, but must remain editable.
            if (isActive(nodeFrom, nodeTo) && /^([*_])(?:[\t ]*\1){3,}[\t ]*$/.test(view.state.doc.sliceString(nodeFrom, nodeTo))) {
              decs.push({ from: nodeFrom, to: nodeTo, value: Decoration.mark({ class: 'cm-strong' }) });
              return;
            }
            decs.push({
              from: nodeFrom,
              to: nodeTo,
              value: Decoration.mark({
                class: 'cm-hr',
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
