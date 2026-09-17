import { useEffect, useRef, useState, type RefObject } from 'react';
import type { TicketStatus } from '@goblin/shared';
import type { DraggedCard } from './tickets';

/**
 * Dragging a card by touch on the horizontal board (issue 11). The mouse drag
 * is the browser's own drag-and-drop, which a finger cannot start without
 * fighting the page for the gesture: an ordinary swipe has to scroll, and only
 * a *deliberate* long-press may lift a card. So touch gets its own gesture,
 * built on pointer events, that ends in the same `drop` the mouse drag ends in
 * — the board's one authority on what a move means.
 *
 * The rules: a still finger for `HOLD_MS` lifts the card; moving further than
 * `SLOP_PX` before that is a scroll and the press is forgotten; once lifted,
 * the page stops scrolling and the card follows the finger, the columns mark
 * themselves as they do for the mouse, and the finger near either edge of the
 * kanban scrolls it sideways to reach a column that is off screen; letting go
 * over a column drops there, letting go anywhere else drops nothing.
 */

const HOLD_MS = 350;
const SLOP_PX = 10;
/** How close to the kanban's edge the finger has to be for it to scroll, and how fast it goes. */
const EDGE_PX = 48;
const EDGE_STEP_PX = 10;

/** The lifted card and where the finger is, for the ghost that follows it. */
export interface TouchLift {
  card: DraggedCard;
  x: number;
  y: number;
}

/** The card under a pointer, read off the element the card itself wrote (`data-key`, `data-status`). */
function cardAt(target: EventTarget | null): DraggedCard | null {
  // a card a bulk action holds is not lifted: nothing else writes to it until the action answers (issue 03b)
  const element = target instanceof Element ? target.closest<HTMLElement>('.gf-card:not([data-locked])') : null;
  const key = element?.dataset.key;
  const status = element?.dataset.status;
  return key && status ? { key, status: status as TicketStatus } : null;
}

/** The column under a point on screen, or `null` between columns. */
function columnAt(x: number, y: number): TicketStatus | null {
  const status = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-status]')?.dataset.status;
  return status ? (status as TicketStatus) : null;
}

/** A `touchmove` that reaches the page scrolls it; while a card is lifted, none may. */
const swallow = (e: TouchEvent) => e.preventDefault();

export function useTouchDrag(
  scroller: RefObject<HTMLElement | null>,
  enabled: boolean,
  handlers: {
    onLift: (card: DraggedCard) => void;
    onOver: (status: TicketStatus | null) => void;
    /** `to` is `null` when the finger let go somewhere that is not a column. */
    onRelease: (card: DraggedCard, to: TicketStatus | null) => void;
  },
) {
  const [lift, setLift] = useState<TouchLift | null>(null);
  // handlers are read through a ref, so the listeners are bound once per `enabled`
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const element = scroller.current;
    if (!enabled || !element) return;

    /** The press in progress: what was touched, where, and whether the hold has run. */
    let press: { card: DraggedCard; pointerId: number; x: number; y: number; timer: ReturnType<typeof setTimeout> | null; lifted: boolean; over: TicketStatus | null } | null = null;
    let edge: number | null = null;
    let lastTouch = 0;

    /** Scrolls the kanban while the finger rests near an edge, one step a frame. */
    const scrollEdge = () => {
      if (press === null || !press.lifted) return;
      const { left, right } = element.getBoundingClientRect();
      const step = press.x < left + EDGE_PX ? -EDGE_STEP_PX : press.x > right - EDGE_PX ? EDGE_STEP_PX : 0;
      if (step !== 0) element.scrollLeft += step;
      edge = requestAnimationFrame(scrollEdge);
    };

    const teardown = () => {
      if (press?.timer) clearTimeout(press.timer);
      if (edge !== null) cancelAnimationFrame(edge);
      edge = null;
      press = null;
      document.removeEventListener('touchmove', swallow);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      setLift(null);
    };

    const onMove = (e: PointerEvent) => {
      if (press === null || e.pointerId !== press.pointerId) return;
      if (!press.lifted) {
        // moved before the hold ran: this is a scroll, and the press is not ours
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP_PX) teardown();
        return;
      }
      press.x = e.clientX;
      press.y = e.clientY;
      setLift({ card: press.card, x: e.clientX, y: e.clientY });
      const over = columnAt(e.clientX, e.clientY);
      if (over !== press.over) {
        press.over = over;
        latest.current.onOver(over);
      }
    };

    /** After a lift, the tap that ends the drag must not also be a click on the link under it. */
    const swallowClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const onUp = (e: PointerEvent) => {
      if (press === null || e.pointerId !== press.pointerId) return;
      const { card, lifted, over } = press;
      if (lifted) {
        window.addEventListener('click', swallowClick, { capture: true, once: true });
        // the listener is dropped again on the next frame in case no click follows at all
        setTimeout(() => window.removeEventListener('click', swallowClick, { capture: true }), 0);
        latest.current.onRelease(card, over);
      }
      teardown();
    };

    const onCancel = (e: PointerEvent) => {
      if (press === null || e.pointerId !== press.pointerId) return;
      if (press.lifted) latest.current.onRelease(press.card, null);
      teardown();
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !e.isPrimary || press !== null) return;
      const card = cardAt(e.target);
      if (card === null) return;
      lastTouch = Date.now();
      press = { card, pointerId: e.pointerId, x: e.clientX, y: e.clientY, timer: null, lifted: false, over: null };
      press.timer = setTimeout(() => {
        if (press === null) return;
        press.lifted = true;
        press.timer = null;
        // from here the finger owns the page: nothing scrolls but the kanban's edges
        document.addEventListener('touchmove', swallow, { passive: false });
        latest.current.onLift(press.card);
        setLift({ card: press.card, x: press.x, y: press.y });
        edge = requestAnimationFrame(scrollEdge);
      }, HOLD_MS);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    };

    /** A long-press is this gesture, not the browser's menu, and not its own drag-and-drop either. */
    const onContextMenu = (e: Event) => {
      if (press !== null || Date.now() - lastTouch < 1000) e.preventDefault();
    };
    const onDragStart = (e: DragEvent) => {
      if (press !== null) e.preventDefault();
    };

    element.addEventListener('pointerdown', onDown);
    element.addEventListener('contextmenu', onContextMenu);
    element.addEventListener('dragstart', onDragStart, { capture: true });
    return () => {
      teardown();
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('contextmenu', onContextMenu);
      element.removeEventListener('dragstart', onDragStart, { capture: true });
    };
  }, [scroller, enabled]);

  return lift;
}
