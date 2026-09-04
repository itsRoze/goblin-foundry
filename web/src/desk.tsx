import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { moveCursor, stillThere, type Columns, type Move } from './cursor';
import { useKeyMap } from './keys';

/**
 * Where keys land on a screen: which tile has the focus, and where the Cursor
 * is inside it (CONTEXT.md "Focused tile", "Cursor").
 *
 * Tiles register themselves and are numbered in *reading order* — sorted by
 * their position in the document, not by the order their effects happened to
 * run — so `⌘1–6` addresses what the eye counts. One tile always has the
 * focus: the first, until a click or a `⌘n` says otherwise, and the first
 * again on the next navigation.
 */

interface Desk {
  /** Tile labels in reading order; the index is the `⌘n` minus one. */
  order: string[];
  focused: string;
  focus: (label: string) => void;
  register: (label: string, el: HTMLElement) => () => void;
  /** The screen's own `esc`, tried before the shell's — a ref, because only one screen is up at a time. */
  escape: { current: (() => boolean) | null };
}

const DeskContext = createContext<Desk | null>(null);

const useDesk = (): Desk => {
  const desk = useContext(DeskContext);
  if (desk === null) throw new Error('a tile outside the desk');
  return desk;
};

const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** `⌘1` through `⌘6`: the tiles a page can have, in reading order (DESIGN.md Interaction). */
const TILE_KEYS = ['1', '2', '3', '4', '5', '6'];

export function DeskProvider({ children }: { children: ReactNode }) {
  const nodes = useRef(new Map<string, HTMLElement>());
  const escape = useRef<(() => boolean) | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  /** Which tile a click or a `⌘n` chose; `null` is "the first one", which is what a fresh page means. */
  const [chosen, setChosen] = useState<string | null>(null);
  const { pathname } = useLocation();

  const resort = useCallback(() => {
    setOrder((prev) => {
      // sorted by where the tiles are on the page, not by the order their effects ran
      const next = [...nodes.current.keys()].sort((a, b) =>
        nodes.current.get(a)!.compareDocumentPosition(nodes.current.get(b)!) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      );
      return same(prev, next) ? prev : next;
    });
  }, []);

  const register = useCallback(
    (label: string, el: HTMLElement) => {
      nodes.current.set(label, el);
      resort();
      return () => {
        nodes.current.delete(label);
        resort();
      };
    },
    [resort],
  );

  // a new page is a new set of tiles, and the focus starts at the top of it
  useEffect(() => setChosen(null), [pathname]);

  const focused = chosen !== null && order.includes(chosen) ? chosen : (order[0] ?? '');

  /**
   * Moving the focus is only ever a state change. It must not blur anything or
   * scroll: this is a click handler too, and both would happen between a
   * mousedown and its mouseup — which moves the target out from under the press
   * and collapses the editor's selection (LESSONS 2026-08-30, twice).
   */
  const focus = useCallback((label: string) => setChosen(label), []);

  /**
   * `⌘n` is the keyed way in, and it *does* let go of the field and bring the
   * tile on screen — there is no press in flight, and a caret left behind in
   * the old tile would make `e` and `j` mean the tile you just left.
   */
  const focusByKey = useCallback(
    (label: string) => {
      setChosen(label);
      const caret = document.activeElement;
      if (caret instanceof HTMLElement && caret !== document.body) caret.blur();
      nodes.current.get(label)?.scrollIntoView({ block: 'nearest' });
    },
    [],
  );

  // a field must not swallow the key that leaves it (`⌘K` is the editor's own, and is not in this map)
  useKeyMap(Object.fromEntries(TILE_KEYS.map((n, i) => [n, () => order[i] !== undefined && focusByKey(order[i]!)])), { meta: true, whileTyping: true });

  const value = useMemo((): Desk => ({ order, focused, focus, register, escape }), [order, focused, focus, register]);
  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}

/** What a `Tile` needs to draw itself: where to hang, its number, and whether keys are addressing it. */
export function useTile(label: string) {
  const desk = useDesk();
  const ref = useRef<HTMLElement>(null);
  const { register } = desk;
  useEffect(() => (ref.current ? register(label, ref.current) : undefined), [register, label]);
  const index = desk.order.indexOf(label);
  return {
    ref,
    // a number is worth printing only where there is another tile to switch to
    n: index === -1 || desk.order.length < 2 ? null : index + 1,
    focused: desk.focused === label,
    focus: () => desk.focus(label),
  };
}

/** Whether keys pressed now are addressing this tile — what a cursor and `a s d` ask before acting. */
export const useTileFocused = (label: string): boolean => useDesk().focused === label;

/** Put the focus on a tile from outside it: `d` lands in `dependencies` before opening its picker. */
export const useFocusTile = (): ((label: string) => void) => useDesk().focus;

/**
 * The screen's own `esc`, tried before the shell's: return `true` when there
 * was something open to close. The shell keeps the fallback — back through
 * in-app history — so a page only has to say what it holds.
 */
export function useEscape(handler: () => boolean) {
  const { escape } = useDesk();
  useEffect(() => {
    escape.current = handler;
    return () => {
      escape.current = null;
    };
  });
}

/** The shell's end of the same slot. */
export const useScreenEscape = (): (() => boolean) => {
  const { escape } = useDesk();
  return useCallback(() => escape.current?.() ?? false, [escape]);
};

/** Where a Cursor's memory lives: per tab, so a refresh keeps it and a second window has its own. */
const CURSOR_KEY = 'gf.cursor';

function readAll(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(CURSOR_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function remember(scope: string, at: string | null) {
  try {
    const all = readAll();
    if (at === null) delete all[scope];
    else all[scope] = at;
    sessionStorage.setItem(CURSOR_KEY, JSON.stringify(all));
  } catch {
    // a device that refuses storage still gets the cursor, just not the memory
  }
}

/**
 * The Cursor in one tile. The caller hands over its rows as columns of ids —
 * a list tile is a board with one column — and what comes back is the id the
 * keys are pointing at.
 *
 * The cursor is *derived* from those columns rather than corrected by an
 * effect: a card the poll dropped takes the cursor with it, a card a
 * transition moved keeps it, and a list that has not loaded yet has no cursor
 * without having forgotten one. What is stored is the id you last pointed at,
 * which is why `⏎` into a Ticket and `esc` back puts you where you were.
 */
export function useCursor({ tile, columns, pathOf }: { tile: string; columns: Columns; pathOf: (id: string) => string }) {
  const { pathname } = useLocation();
  const scope = `${pathname}#${tile}`;
  const nav = useNavigate();
  const focused = useTileFocused(tile);
  const [wanted, setWanted] = useState<string | null>(() => readAll()[scope] ?? null);
  const at = stillThere(columns, wanted);

  const set = useCallback(
    (next: string | null) => {
      setWanted(next);
      remember(scope, next);
    },
    [scope],
  );
  const go = (move: Move) => set(moveCursor(columns, at, move));

  /**
   * A cursor you cannot see is an armed control with no readout — `a`, `s`,
   * `d` and `⏎` all fire on it — and the kanban scrolls sideways inside its
   * own tile, so `h/l` walks off the edge within a few presses. The mark is
   * brought back into view instead. `nearest` does nothing when it is already
   * on screen, and the scroll is instant: Motion's 200ms is for a thing
   * moving, and a scroll chasing `jjjj` at 200ms is a smear.
   */
  useEffect(() => {
    if (at === null || !focused) return;
    document.querySelector('.gf-tile.is-focus .is-cursor')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [at, focused]);

  useKeyMap(
    {
      j: () => go('j'),
      ArrowDown: () => go('j'),
      k: () => go('k'),
      ArrowUp: () => go('k'),
      h: () => go('h'),
      ArrowLeft: () => go('h'),
      l: () => go('l'),
      ArrowRight: () => go('l'),
      Enter: at === null ? undefined : () => nav(pathOf(at)),
    },
    { active: focused },
  );

  // the Cursor sits in the Focused tile (CONTEXT.md), so the mark leaves with the focus and comes back with it
  return { at, set, isAt: (id: string) => focused && id === at };
}
