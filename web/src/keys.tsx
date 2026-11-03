import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';

/**
 * A field owns its keys — except a control that says it has none of its own
 * (`data-passes-keys`): a card's Selection checkbox keeps the focus after a
 * click, and `j`, `x` and `esc` must go on meaning the board (issue 03b). It is
 * opt-in because other checkboxes live in popovers that answer `esc` themselves.
 */
export const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  !('passesKeys' in t.dataset) &&
  (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

/** A link or button answers `⏎` itself (GF-39); the graph canvas, focusable for its pan and zoom keys, holds it and answers with nothing (GF-80). */
export const holdsEnter = (t: EventTarget | null): t is HTMLElement | SVGElement =>
  (t instanceof HTMLElement || t instanceof SVGElement) && t.matches('a[href], button, svg[tabindex]');

export function letGoOfEnter() {
  const held = document.activeElement;
  if (holdsEnter(held)) held.blur();
}

/**
 * A held `⏎` acts once (GF-82): on the answers a question puts under the focus, and on the
 * control that gets the focus back when the question closes, the repeats are ignored.
 */
export function ignoreHeldEnter(e: React.KeyboardEvent) {
  if (isHeldEnter(e)) e.preventDefault();
}

const isHeldEnter = (e: { key: string; repeat: boolean }) => e.key === 'Enter' && e.repeat;

const focusedOnce = new WeakSet<object>();

/**
 * Whether the press in flight came from a pointer, whose finger may still be on the spot. What a
 * pointer's press opens must not scroll under it (LESSONS 2026-08-30); a key's press has no finger
 * on the screen, so what it opens comes into view. A click a key synthesised has `detail` 0.
 */
export const byPointer = (e: Event | undefined) => e instanceof DragEvent || (e instanceof MouseEvent && e.detail > 0);

const byKey = (e: Event | undefined) => e instanceof KeyboardEvent || (e instanceof MouseEvent && !byPointer(e));

/**
 * The safe answer takes the focus once per question, for the press that asked it, so `⏎` dismisses
 * what was not read and the action is a ⇧Tab away (GF-44). The board redraws a question when its card
 * moves or the board restacks; that is the same question, and it does not take the focus again. A
 * field holding the caret keeps it. A key's question comes into view; a pointer's opens where it is.
 */
export function useFocusOnAsk(question: object | null, answer: RefObject<HTMLElement | null>, line: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (question === null || focusedOnce.has(question)) return;
    focusedOnce.add(question);
    if (isTyping(document.activeElement)) return;
    const pointer = byPointer(window.event);
    answer.current?.focus({ preventScroll: pointer });
    if (!pointer) line.current?.scrollIntoView({ block: 'nearest' });
  }, [question, answer, line]);
}

/**
 * What a control opened has closed and taken the focus with it: the focus comes back to that
 * control instead of lying on `body`, where `⏎` is the Cursor's (GF-39, GF-44). A focus that
 * went somewhere else, such as the next picker's input, is left there. Nothing but a key's own
 * close scrolls, and that only by what the control is clipped: a bare `focus()` centres it, which
 * moved the page 379px to bring back 29. A close that lands after a write has no press in
 * `window.event` to go by, so it counts as a pointer's.
 */
export function useFocusOnClose(open: boolean, control: RefObject<HTMLElement | null>) {
  const was = useRef(open);
  useEffect(() => {
    if (was.current && !open && document.activeElement === document.body) {
      control.current?.focus({ preventScroll: true });
      if (byKey(window.event)) control.current?.scrollIntoView({ block: 'nearest' });
    }
    was.current = open;
  }, [open, control]);
}

/**
 * Several keys at once, one handler each (DESIGN.md Interaction: keyboard
 * first). Bare by default, with `⌘`/`ctrl` when `meta` is asked for; a typing
 * target silences all of them, which is what leaves `⌘K` to the editor's link
 * command and `esc` to whichever input holds the caret. So does a key that
 * is already `defaultPrevented`: a control that answered it, or holds it
 * while it has the focus, has claimed it; a check popover is a focused
 * `div`, which no tag test catches (GF-41, GF-92).
 * The map's own `preventDefault` claims a key the same way, so two maps on
 * one key would hear only the first registered; no screen binds one twice.
 *
 * The map is read through a ref, so a handler that closes over this render's
 * state does not re-register the listener on every render — and `active` is
 * what a tile that does not have focus turns off.
 *
 * `whileTyping` is for the few keys a field must *not* swallow. Every long
 * field on a view is the editor and the read view at once (ADR-0005), so the
 * caret lives in one most of the time; `⌘1–6` moving the focused tile has to
 * work from in there, or the numbers printed on every header are a mode with
 * no mode line. `⌘K` is not one of these — inside an editor it is the link
 * command, which is the whole reason the guard exists.
 *
 * `shift` is asked of *named* keys only (`ArrowDown`, `Enter`): a printable
 * key already says whether shift was down — `x` is not `X` — but an arrow is
 * `ArrowDown` either way, and `⇧↓` extends a Selection where `↓` moves the
 * Cursor (issue 03b).
 */
export function useKeyMap(
  map: Record<string, (() => void) | undefined>,
  { meta = false, shift = false, active = true, whileTyping = false }: { meta?: boolean; shift?: boolean; active?: boolean; whileTyping?: boolean } = {},
) {
  const latest = useRef(map);
  useEffect(() => {
    latest.current = map;
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) !== meta || e.altKey) return;
      if (e.key.length > 1 && e.shiftKey !== shift) return;
      if (isTyping(e.target) && !whileTyping) return;
      if (e.key === 'Enter' && holdsEnter(e.target)) return;
      if (isHeldEnter(e)) return;
      const handler = latest.current[e.key];
      if (!handler) return;
      e.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [meta, shift, active]);
}

/** One key: `⌘⌫` trashes, `c` creates. `⌘⏎` and `esc` inside forms are handled by the form itself. */
export function useKey(key: string, handler: (() => void) | undefined, { meta = false }: { meta?: boolean } = {}) {
  useKeyMap({ [key]: handler }, { meta, active: handler !== undefined });
}

/** Inside a form: `⌘⏎` (or `ctrl⏎`) saves, `esc` cancels. */
export function formKeys(save: () => void, cancel: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };
}
