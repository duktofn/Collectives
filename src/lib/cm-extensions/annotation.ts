import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  hoverTooltip,
} from "@codemirror/view";
import { RangeSetBuilder, Extension } from "@codemirror/state";
import { EmptyWidget } from "./empty-widget";

interface DecSpec {
  from: number;
  to: number;
  value: Decoration;
}

// Find all footnote definitions [^id]: content
export function getFootnoteDefinitions(doc: import("@codemirror/state").Text): Record<string, { content: string; line: number }> {
  const definitions: Record<string, { content: string; line: number }> = {};
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i).text;
    const match = line.match(/^\[\^([^\]]+)\]:\s*(.*)$/);
    if (match) {
      definitions[match[1]] = {
        content: match[2],
        line: i,
      };
    }
  }
  return definitions;
}

// Tooltip plugin for hover footnote content
const footnoteTooltip = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos);
  const lineText = line.text;
  const relativePos = pos - line.from;

  const regex = /\[\^([^\]]+)\]/g;
  let match;
  while ((match = regex.exec(lineText)) !== null) {
    const start = match.index;
    const end = match.index + match[0].length;
    // Check if footnote reference is a definition (starts line) or inline ref
    const isDefinition = lineText.trim().startsWith(`[^${match[1]}]:`);
    
    if (relativePos >= start && relativePos <= end && !isDefinition) {
      const id = match[1];
      const absStart = line.from + start;
      const absEnd = line.from + end;

      const definitions = getFootnoteDefinitions(view.state.doc);
      const def = definitions[id];
      const content = def ? def.content : `No definition found for [^${id}]`;

      return {
        pos: absStart,
        end: absEnd,
        above: true,
        arrow: true,
        create(_view) {
          const dom = document.createElement("div");
          dom.className = "cm-annotation-tooltip";
          dom.textContent = content;
          return { dom };
        },
      };
    }
  }
  return null;
});

// Decoration plugin to style [^noteId] inline refs
class AnnotationDecPlugin {
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
    const doc = view.state.doc;
    const selection = view.state.selection.main;

    for (const { from, to } of view.visibleRanges) {
      let pos = from;
      while (pos < to) {
        const line = doc.lineAt(pos);
        const lineText = line.text;
        const isCursorInLine =
          selection.head >= line.from && selection.head <= line.to;

        const isDefinition = /^\[\^[^\]]+\]:/.test(lineText.trim());
        if (!isDefinition) {
          const regex = /\[\^([^\]]+)\]/g;
          let match;
          while ((match = regex.exec(lineText)) !== null) {
            const start = line.from + match.index;
            const end = start + match[0].length;

            if (start >= from && end <= to) {
              // Add a decoration class for styling
              decs.push({
                from: start,
                to: end,
                value: Decoration.mark({
                  class: "cm-footnote-ref",
                }),
              });

              // Hide [^ and ] if cursor is not in line
              if (!isCursorInLine) {
                decs.push({
                  from: start,
                  to: start + 2,
                  value: Decoration.replace({ widget: new EmptyWidget() }),
                });
                decs.push({
                  from: end - 1,
                  to: end,
                  value: Decoration.replace({ widget: new EmptyWidget() }),
                });
              }
            }
          }
        }
        pos = line.to + 1;
      }
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
    for (const d of decs) {
      const isReplacement = d.value.spec.widget !== undefined;
      builder.add(d.from, d.to, d.value);
      if (isReplacement) {
        atomicBuilder.add(d.from, d.to, d.value);
      }
    }

    return {
      decorations: builder.finish(),
      atomic: atomicBuilder.finish(),
    };
  }
}

const footnoteDecorations = ViewPlugin.fromClass(AnnotationDecPlugin, {
  decorations: (v) => v.decorations,
});

export const annotationExtension: Extension = [
  footnoteTooltip,
  footnoteDecorations,
  EditorView.atomicRanges.of((view) => {
    const plugin = view.plugin(footnoteDecorations);
    return plugin ? plugin.atomic : Decoration.none;
  }),
];
