import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { NODE_H, type LaidNode } from './graph';

type Camera = { x: number; y: number; scale: number };
type Point = { x: number; y: number };

/** A bounded camera: open fitted, then zoom around the pointer or focus a readable ticket. */
export function useGraphViewport(width: number, height: number, entry: Point, expanded: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState<Camera | null>(null);
  const [panning, setPanning] = useState(false);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ camera: Camera; centre: Point; distance: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const fitScale = size.width ? Math.min(1, size.width / width, size.height / height) : 1;
  const minScale = Math.min(fitScale, 0.35);
  const constrain = (next: Camera): Camera => {
    const w = size.width / next.scale;
    const h = size.height / next.scale;
    const margin = 24 / next.scale;
    return {
      ...next,
      x: w >= width ? (width - w) / 2 : Math.max(-margin, Math.min(width - w + margin, next.x)),
      y: h >= height ? (height - h) / 2 : Math.max(-margin, Math.min(height - h + margin, next.y)),
    };
  };
  const fitted = constrain({ x: 0, y: 0, scale: fitScale });
  const initial = fitted;
  const view = constrain(camera ?? initial);
  // Input events can arrive faster than React paints. Each gesture builds on the latest camera.
  const latest = useRef(view);
  useLayoutEffect(() => { latest.current = view; });
  const commit = (next: Camera) => {
    latest.current = constrain(next);
    setCamera(latest.current);
  };
  const zoom = (scale: number, point = { x: size.width / 2, y: size.height / 2 }) => {
    const before = latest.current;
    const next = Math.max(minScale, Math.min(2, scale));
    commit({ x: before.x + point.x / before.scale - point.x / next, y: before.y + point.y / before.scale - point.y / next, scale: next });
  };
  const fit = () => commit(fitted);
  const reset = () => commit(constrain({ x: entry.x - 24, y: entry.y - size.height / 2, scale: 1 }));

  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const measure = () => setSize({ width: box.clientWidth, height: box.clientHeight });
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(box);
    return () => observer.disconnect();
  }, [width, height, expanded]);
  useLayoutEffect(() => { setCamera(null); }, [width, height, expanded]);

  const wheel = useRef<(event: WheelEvent) => void>(() => {});
  useLayoutEffect(() => {
    wheel.current = (event) => {
      event.preventDefault();
      const box = ref.current!.getBoundingClientRect();
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
      const current = latest.current;
      if (event.ctrlKey || event.metaKey) {
        zoom(current.scale * Math.exp(-event.deltaY * factor * 0.01), { x: event.clientX - box.left, y: event.clientY - box.top });
      } else {
        const dx = event.shiftKey ? event.deltaY : event.deltaX;
        const dy = event.shiftKey ? 0 : event.deltaY;
        commit({ ...current, x: current.x + dx * factor / current.scale, y: current.y + dy * factor / current.scale });
      }
    };
  });
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const onWheel = (event: WheelEvent) => wheel.current(event);
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, [expanded, width, height]);

  const focus = (node: LaidNode) => {
    const current = latest.current;
    const scale = Math.max(current.scale, 1);
    const w = size.width / scale;
    const h = size.height / scale;
    if (scale !== current.scale || node.x < current.x + 16 || node.x + node.width > current.x + w || node.y < current.y + 24 || node.y + NODE_H > current.y + h) {
      commit({ x: node.x + node.width / 2 - w / 2, y: node.y + NODE_H / 2 - h / 2, scale });
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const current = latest.current;
    const step = 48 / current.scale;
    switch (event.key) {
      case 'ArrowLeft': commit({ ...current, x: current.x - step }); break;
      case 'ArrowRight': commit({ ...current, x: current.x + step }); break;
      case 'ArrowUp': commit({ ...current, y: current.y - step }); break;
      case 'ArrowDown': commit({ ...current, y: current.y + step }); break;
      case '+': case '=': zoom(current.scale * 1.25); break;
      case '-': zoom(current.scale / 1.25); break;
      case 'Home': reset(); break;
      case '0': fit(); break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
  };
  const startGesture = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a) { gesture.current = null; setPanning(false); return; }
    gesture.current = {
      camera: latest.current,
      centre: b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a,
      distance: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0,
      moved: suppressClick.current,
    };
  };
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    if (!pointers.current.size) suppressClick.current = false;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size > 1) suppressClick.current = true;
    startGesture();
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const start = gesture.current;
    const [a, b] = [...pointers.current.values()];
    if (!start || !a) return;
    const centre = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a;
    const dx = centre.x - start.centre.x;
    const dy = centre.y - start.centre.y;
    if (!b && !start.moved && Math.hypot(dx, dy) < 5) return;
    start.moved = true;
    suppressClick.current = true;
    setPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    const scale = b && start.distance ? Math.max(minScale, Math.min(2, start.camera.scale * Math.hypot(a.x - b.x, a.y - b.y) / start.distance)) : start.camera.scale;
    const box = event.currentTarget.getBoundingClientRect();
    commit({
      scale,
      x: start.camera.x + (start.centre.x - box.left) / start.camera.scale - (centre.x - box.left) / scale,
      y: start.camera.y + (start.centre.y - box.top) / start.camera.scale - (centre.y - box.top) / scale,
    });
  };
  const endPointer = (event: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    startGesture();
  };
  return {
    ref, view, panning, available: size.width, viewportHeight: size.height, fitScale, minScale, zoom, focus, fit, reset,
    svgProps: {
      viewBox: `${view.x} ${view.y} ${size.width / view.scale || width} ${size.height / view.scale || height}`,
      onKeyDown, onPointerDown, onPointerMove, onPointerUp: endPointer, onPointerCancel: endPointer,
      onPointerLeave: (event: PointerEvent<SVGSVGElement>) => {
        // Before the drag threshold there is no capture, so a release outside
        // would never reach us. A captured drag keeps running across the edge.
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) endPointer(event);
      },
      onLostPointerCapture: (event: PointerEvent<SVGSVGElement>) => {
        if (event.target === event.currentTarget && pointers.current.has(event.pointerId)) endPointer(event);
      },
      onClickCapture: (event: React.MouseEvent) => {
        if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; }
      },
      onDoubleClick: (event: React.MouseEvent<SVGSVGElement>) => {
        if ((event.target as Element).closest('a')) return;
        const box = event.currentTarget.getBoundingClientRect();
        zoom(latest.current.scale * 1.5, { x: event.clientX - box.left, y: event.clientY - box.top });
      },
    },
  };
}
