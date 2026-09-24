import { useLayoutEffect, useRef } from 'react';

/** Content-height grid tracks, without moving tiles out of DOM/shortcut order. */
export function useTileLayout() {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const desk = ref.current;
    if (!desk) return;
    let frame = 0;
    let children: HTMLElement[] = [];
    const pack = () => {
      frame = 0;
      const gap = parseFloat(getComputedStyle(desk).columnGap);
      desk.classList.add('is-packed');
      for (const child of children) {
        // align-items:start keeps this the content height, independent of its span.
        child.style.gridRowEnd = `span ${Math.ceil(child.getBoundingClientRect().height + gap)}`;
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(pack);
    };
    const resize = new ResizeObserver(schedule);
    const observe = () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      children = Array.from(desk.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
      resize.observe(desk);
      for (const child of children) resize.observe(child);
      pack();
    };
    const mutations = new MutationObserver(observe);
    mutations.observe(desk, { childList: true });
    observe();
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
      desk.classList.remove('is-packed');
      for (const child of children) child.style.removeProperty('grid-row-end');
    };
  }, []);
  return ref;
}
