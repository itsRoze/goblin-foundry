import { useEffect, useRef } from 'react';

/**
 * A field owns its keys — except a control that says it has none of its own
 * (`data-passes-keys`): a card's Selection checkbox keeps the focus after a
 * click, and `j`, `x` and `esc` must go on meaning the board (issue 03b). It is
 * opt-in because other checkboxes live in popovers that answer `esc` themselves.
 */
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  !('passesKeys' in t.dataset) &&
  (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

/**
 * Several keys at once, one handler each (DESIGN.md Interaction: keyboard
 * first). Bare by default, with `⌘`/`ctrl` when `meta` is asked for; a typing
 * target silences all of them, which is what leaves `⌘K` to the editor's link
 * command and `esc` to whichever input holds the caret.
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
      if ((e.metaKey || e.ctrlKey) !== meta || e.altKey) return;
      if (e.key.length > 1 && e.shiftKey !== shift) return;
      if (isTyping(e.target) && !whileTyping) return;
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
