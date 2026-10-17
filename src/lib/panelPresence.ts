import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';

export function createPanelPresence(open: Accessor<boolean>, duration = 220) {
  const [mounted, setMounted] = createSignal(open());
  const [visible, setVisible] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  createEffect(() => {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (open()) {
      setMounted(true);
      if (reduced) setVisible(true);
      else
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => setVisible(true));
        });
    } else {
      setVisible(false);
      timer = setTimeout(() => setMounted(false), reduced ? 0 : duration);
    }
  });
  onCleanup(() => {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
  });
  return { mounted, visible };
}
