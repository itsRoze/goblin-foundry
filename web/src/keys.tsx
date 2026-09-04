import { useEffect, useRef } from 'react';

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

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
 */
export function useKeyMap(
  map: Record<string, (() => void) | undefined>,
  { meta = false, active = true, whileTyping = false }: { meta?: boolean; active?: boolean; whileTyping?: boolean } = {},
) {
  const latest = useRef(map);
  useEffect(() => {
    latest.current = map;
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) !== meta || e.altKey) return;
      if (isTyping(e.target) && !whileTyping) return;
      const handler = latest.current[e.key];
      if (!handler) return;
      e.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [meta, active]);
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
