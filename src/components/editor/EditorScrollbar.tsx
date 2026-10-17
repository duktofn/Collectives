import { createEffect, createSignal, createUniqueId, onCleanup } from 'solid-js';
import type { EditorView } from '@codemirror/view';

export function EditorScrollbar(props: { view: () => EditorView | undefined }) {
  const id = `editor-scroll-${createUniqueId()}`;
  const [metrics, setMetrics] = createSignal({ top: 0, size: 0, maximum: 0, position: 0 });
  const [dragging, setDragging] = createSignal(false);
  let track!: HTMLDivElement;
  let scroller: HTMLElement | undefined;
  let dragOffset = 0;
  let pointerId: number | undefined;

  createEffect(() => {
    const view = props.view();
    if (!view) return;
    const element = view.scrollDOM;
    scroller = element;
    const previousId = element.id;
    element.id = id;
    element.classList.add('editor-managed-scroll');
    let frame = 0;
    const measure = () => {
      frame = 0;
      const height = track.clientHeight;
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
      const size = Math.min(
        height,
        Math.max(28, (height * element.clientHeight) / Math.max(1, element.scrollHeight))
      );
      const position = Math.max(0, Math.min(maximum, element.scrollTop));
      const top = maximum > 0 ? (position / maximum) * (height - size) : 0;
      setMetrics((old) =>
        old.top === top && old.size === size && old.maximum === maximum && old.position === position
          ? old
          : { top, size, maximum, position }
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    resize?.observe(element);
    resize?.observe(view.contentDOM);
    resize?.observe(track);
    window.addEventListener('resize', schedule);
    const mutations = new MutationObserver(schedule);
    mutations.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style'],
    });
    element.addEventListener('scroll', schedule, { passive: true });
    schedule();
    onCleanup(() => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      window.removeEventListener('resize', schedule);
      mutations.disconnect();
      element.removeEventListener('scroll', schedule);
      element.classList.remove('editor-managed-scroll');
      if (element.id === id) element.id = previousId;
      if (scroller === element) scroller = undefined;
      pointerId = undefined;
      setDragging(false);
    });
  });

  const moveToPointer = (event: PointerEvent) => {
    if (!scroller) return;
    const travel = track.clientHeight - metrics().size;
    const offset = event.clientY - track.getBoundingClientRect().top - dragOffset;
    if (travel > 0)
      scroller.scrollTop = Math.max(0, Math.min(1, offset / travel)) * metrics().maximum;
  };
  const finish = () => {
    pointerId = undefined;
    setDragging(false);
  };

  return (
    <div
      ref={track}
      class="editor-scrollbar"
      classList={{ 'is-dragging': dragging() }}
      role="scrollbar"
      aria-label="Scroll document"
      aria-orientation="vertical"
      aria-controls={id}
      aria-valuemin={0}
      aria-valuemax={Math.round(metrics().maximum)}
      aria-valuenow={Math.round(metrics().position)}
      aria-hidden={metrics().maximum <= 1 ? 'true' : undefined}
      tabIndex={metrics().maximum > 1 ? 0 : -1}
      style={{ visibility: metrics().maximum > 1 ? 'visible' : 'hidden' }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !scroller) return;
        event.preventDefault();
        event.stopPropagation();
        pointerId = event.pointerId;
        dragOffset = (event.target as HTMLElement).closest('.editor-scrollbar-thumb')
          ? event.clientY - track.getBoundingClientRect().top - metrics().top
          : metrics().size / 2;
        setDragging(true);
        track.setPointerCapture(event.pointerId);
        moveToPointer(event);
      }}
      onPointerMove={(event) => {
        if (pointerId === event.pointerId) moveToPointer(event);
      }}
      onPointerUp={(event) => {
        if (pointerId !== event.pointerId) return;
        if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
        finish();
      }}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onWheel={(event) => {
        if (!scroller) return;
        event.preventDefault();
        scroller.scrollTop +=
          event.deltaY *
          (event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? scroller.clientHeight : 1);
      }}
      onKeyDown={(event) => {
        if (
          !scroller ||
          !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const direction = event.key === 'ArrowUp' || event.key === 'PageUp' ? -1 : 1;
        if (event.key === 'Home') scroller.scrollTop = 0;
        else if (event.key === 'End') scroller.scrollTop = metrics().maximum;
        else
          scroller.scrollTop +=
            direction * (event.key.startsWith('Page') ? scroller.clientHeight * 0.9 : 40);
      }}
    >
      <div
        class="editor-scrollbar-thumb"
        aria-hidden="true"
        style={{ height: `${metrics().size}px`, transform: `translateY(${metrics().top}px)` }}
      />
    </div>
  );
}
