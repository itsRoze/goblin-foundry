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
      // A tile shrinking can send the tiles after it to another column, and one with a question standing is being aimed at (GF-116),
      // so tracks wait to shrink until it goes, whose going resizes its tile and so packs again. A tile that grew still gets its room, or it would lie over the next.
      const held = desk.querySelector('[data-holds-desk]') !== null;
      for (const child of children) {
        // align-items:start keeps this the content height, independent of its span.
        const needs = Math.ceil(child.getBoundingClientRect().height + gap);
        const has = Number(child.style.gridRowEnd.replace('span ', ''));
        child.style.gridRowEnd = `span ${held ? Math.max(needs, has) : needs}`;
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
