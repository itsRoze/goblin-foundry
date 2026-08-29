import { useEffect } from 'react';

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

/**
 * A key outside any input (DESIGN.md §8: keyboard first) — bare by default,
 * with `⌘`/`ctrl` when `meta` is asked for (`⌘⌫` trashes). `⌘⏎` and `esc`
 * inside forms are handled by the form itself.
 */
export function useKey(key: string, handler: (() => void) | undefined, { meta = false }: { meta?: boolean } = {}) {
  useEffect(() => {
    if (!handler) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== key || (e.metaKey || e.ctrlKey) !== meta) return;
      if (e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, handler, meta]);
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
