import {
  EditorSelection,
  EditorState,
  findClusterBreak,
  type SelectionRange,
} from '@codemirror/state';
import { EditorView, type MouseSelectionStyle } from '@codemirror/view';
import { editorModeFacet } from './facet';

interface CaretDocument extends Document {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
}

function rangeForClick(state: EditorState, position: number, count: number): SelectionRange {
  if (count === 1) return EditorSelection.cursor(position);
  const line = state.doc.lineAt(position);
  if (count >= 3) {
    return EditorSelection.undirectionalRange(line.from, Math.min(state.doc.length, line.to + 1));
  }
  if (!line.length) return EditorSelection.cursor(position);
  const categorize = state.charCategorizer(position);
  let from = position - line.from;
  let to = from;
  if (from === line.length) from = findClusterBreak(line.text, from, false);
  else to = findClusterBreak(line.text, to);
  const category = categorize(line.text.slice(from, to));
  while (from > 0) {
    const previous = findClusterBreak(line.text, from, false);
    if (categorize(line.text.slice(previous, from)) !== category) break;
    from = previous;
  }
  while (to < line.length) {
    const next = findClusterBreak(line.text, to);
    if (categorize(line.text.slice(to, next)) !== category) break;
    to = next;
  }
  return EditorSelection.undirectionalRange(line.from + from, line.from + to);
}

function sourceAtDisplayedPoint(view: EditorView, event: MouseEvent): number | null {
  const document = view.contentDOM.ownerDocument as CaretDocument;
  const caret = document.caretPositionFromPoint?.(event.clientX, event.clientY);
  const range = caret ? null : document.caretRangeFromPoint?.(event.clientX, event.clientY);
  const node = caret?.offsetNode ?? range?.startContainer;
  const offset = caret?.offset ?? range?.startOffset;
  if (!node || offset === undefined || !view.contentDOM.contains(node)) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const line = element?.closest('.cm-line');
  if (!line || !view.contentDOM.contains(line)) return null;
  // posAtDOM does not flush pending measurements. posAtCoords does, which can
  // move the viewport after the user has already clicked the displayed glyph.
  try {
    return view.posAtDOM(node, offset);
  } catch {
    return null;
  }
}

/** Resolve the glyph the user saw before a measurement can move the viewport. */
export const displayedTextPointerSelection = EditorView.mouseSelectionStyle.of(
  (view, startEvent): MouseSelectionStyle | null => {
    if (
      startEvent.button !== 0 ||
      view.state.facet(EditorState.readOnly) ||
      view.state.facet(editorModeFacet) !== 'edit-render'
    )
      return null;
    // Embedded editors and controls keep their own selection and focus behavior.
    const target = startEvent.target;
    const element =
      target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    if (!element?.closest('.cm-line') || element.closest('button,input,textarea,select'))
      return null;
    const editingHost = element.closest('[contenteditable]');
    if (editingHost && editingHost !== view.contentDOM) return null;
    let start = sourceAtDisplayedPoint(view, startEvent);
    if (start === null) return null;
    const count = Math.max(1, startEvent.detail);
    let original = view.state.selection;
    return {
      update(update) {
        if (update.docChanged) {
          start = update.changes.mapPos(start!);
          original = original.map(update.changes);
        }
      },
      get(event, extend, multiple) {
        const position =
          event === startEvent
            ? start!
            : (sourceAtDisplayedPoint(view, event) ??
              view.posAtCoords({ x: event.clientX, y: event.clientY }, false) ??
              start!);
        let range = rangeForClick(view.state, position, count);
        if (position !== start! && !extend) {
          const initial = rangeForClick(view.state, start!, count);
          const from = Math.min(initial.from, range.from);
          const to = Math.max(initial.to, range.to);
          range =
            position < start! ? EditorSelection.range(to, from) : EditorSelection.range(from, to);
        }
        if (extend)
          return original.replaceRange(original.main.extend(range.from, range.to, range.assoc));
        if (multiple) {
          const index = original.ranges.findIndex(
            (item) => item.from <= position && item.to >= position
          );
          if (count === 1 && index >= 0 && original.ranges.length > 1 && range.empty) {
            const ranges = original.ranges.filter((_item, i) => i !== index);
            const mainIndex =
              original.mainIndex === index
                ? 0
                : original.mainIndex - (original.mainIndex > index ? 1 : 0);
            return EditorSelection.create(ranges, mainIndex);
          }
          return original.addRange(range);
        }
        return EditorSelection.create([range]);
      },
    };
  }
);
