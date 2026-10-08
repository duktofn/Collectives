import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, type MouseSelectionStyle } from '@codemirror/view';
import { editorModeFacet } from './facet';

interface CaretDocument extends Document {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
}

function sourceAtDisplayedPoint(
  view: EditorView,
  event: MouseEvent,
  codeOnly: boolean
): number | null {
  const document = view.contentDOM.ownerDocument as CaretDocument;
  const caret = document.caretPositionFromPoint?.(event.clientX, event.clientY);
  const range = caret ? null : document.caretRangeFromPoint?.(event.clientX, event.clientY);
  const node = caret?.offsetNode ?? range?.startContainer;
  const offset = caret?.offset ?? range?.startOffset;
  if (!node || offset === undefined || !view.contentDOM.contains(node)) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const line = element?.closest(codeOnly ? '.cm-codeblock-line' : '.cm-line');
  if (!line || !view.contentDOM.contains(line)) return null;
  // posAtDOM does not flush pending measurements. posAtCoords does, which can
  // move the viewport after the user has already clicked the displayed glyph.
  try {
    return view.posAtDOM(node, offset);
  } catch {
    return null;
  }
}

export const codePointerSelection = EditorView.mouseSelectionStyle.of(
  (view, startEvent): MouseSelectionStyle | null => {
    if (
      startEvent.button !== 0 ||
      startEvent.detail > 1 ||
      view.state.facet(EditorState.readOnly) ||
      view.state.facet(editorModeFacet) !== 'edit-render'
    )
      return null;
    let start = sourceAtDisplayedPoint(view, startEvent, true);
    if (start === null) return null;
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
            : (sourceAtDisplayedPoint(view, event, false) ??
              view.posAtCoords({ x: event.clientX, y: event.clientY }, false) ??
              start!);
        const range = EditorSelection.range(start!, position);
        if (extend) return original.replaceRange(original.main.extend(position, position));
        if (multiple) {
          const index = original.ranges.findIndex(
            (item) => item.from <= position && item.to >= position
          );
          if (index >= 0 && original.ranges.length > 1 && range.empty) {
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
