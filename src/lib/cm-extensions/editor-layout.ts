import { EditorView, ViewPlugin } from '@codemirror/view';
import { displayedTextPointerSelection } from './pointer-selection';

/**
 * Height changes inside a block do not resize the editor's scroll container.
 * Observe the rendered blocks themselves so arbitrary widgets, wrapped lines,
 * and asynchronously loaded media all invalidate CodeMirror's measurements.
 */
class EditorLayoutObserver {
  private resizeObserver: ResizeObserver | null;
  private mutationObserver: MutationObserver;
  private observed = new Set<Element>();
  private destroyed = false;
  private fonts: FontFaceSet | undefined;

  constructor(private view: EditorView) {
    this.resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(this.requestMeasure);
    this.mutationObserver = new MutationObserver(() => this.observeBlocks());
    this.mutationObserver.observe(view.contentDOM, { childList: true });
    this.resizeObserver?.observe(view.contentDOM);
    this.observeBlocks();
    this.fonts = view.contentDOM.ownerDocument.fonts;
    this.fonts?.addEventListener('loadingdone', this.requestMeasure);
  }

  private requestMeasure = () => {
    if (!this.destroyed) this.view.requestMeasure();
  };

  private observeBlocks() {
    if (this.destroyed || !this.resizeObserver) return;
    const children = new Set(this.view.contentDOM.children);
    for (const element of this.observed) {
      if (!children.has(element)) this.resizeObserver.unobserve(element);
    }
    for (const element of children) {
      if (!this.observed.has(element)) this.resizeObserver.observe(element, { box: 'border-box' });
    }
    this.observed = children;
  }

  destroy() {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.mutationObserver.disconnect();
    this.fonts?.removeEventListener('loadingdone', this.requestMeasure);
    this.observed.clear();
  }
}

export const editorLayoutExtension = [
  ViewPlugin.fromClass(EditorLayoutObserver),
  displayedTextPointerSelection,
];
