/**
 * What you have gathered (CONTEXT.md "Selection"): a set of Tickets on the
 * current filtered board, for one all-or-none bulk action. It is not the
 * Cursor — that is where you are — and nothing here knows about keys, cards or
 * the screen: members are Ticket *ids*, which outlive a prefix change, a poll
 * and a trip into a Ticket view, and the board is handed over as the order a
 * range runs in.
 *
 * Two sets, because a range is provisional and a pick is not. `picked` is what
 * was chosen one by one (or settled from an earlier range); `ranged` is what
 * the live range covers. Redrawing the range replaces `ranged` alone, which is
 * how extending and contracting it never erases an independent choice.
 */
export interface Selection {
  picked: ReadonlySet<number>;
  ranged: ReadonlySet<number>;
  /** Where a range starts: the most recent individual selection, or `null` when there is none. */
  anchor: number | null;
}

export const EMPTY_SELECTION: Selection = { picked: new Set(), ranged: new Set(), anchor: null };

export const membersOf = (s: Selection): Set<number> => new Set([...s.picked, ...s.ranged]);
export const isSelected = (s: Selection, id: number): boolean => s.picked.has(id) || s.ranged.has(id);
export const sizeOf = (s: Selection): number => membersOf(s).size;

/**
 * The order a range runs in: columns in lifecycle order, each top to bottom —
 * and only the columns that are open, because a range never reaches into a
 * folded section (what is already selected in one is left alone).
 */
export function rangeOrder<S extends string>(columns: readonly { status: S; ids: readonly number[] }[], isOpen: (status: S) => boolean): number[] {
  return columns.filter((column) => isOpen(column.status)).flatMap((column) => [...column.ids]);
}

/** One Ticket in or out — a checkbox, or `x`. Whatever a range had gathered is settled first, so it stays. */
export function toggle(s: Selection, id: number): Selection {
  const picked = membersOf(s);
  if (picked.delete(id)) return { picked, ranged: new Set(), anchor: null };
  picked.add(id);
  return { picked, ranged: new Set(), anchor: id };
}

/**
 * Shift-click, or a shifted arrow: everything from the anchor to `target`,
 * both ends included. With no anchor — or one the order no longer holds,
 * folded away or gone — the target is selected and becomes the anchor, so the
 * first range gesture always does something you can see.
 */
export function rangeTo(s: Selection, order: readonly number[], target: number): Selection {
  const from = s.anchor === null ? -1 : order.indexOf(s.anchor);
  const to = order.indexOf(target);
  if (to === -1) return s;
  if (from === -1) return { picked: new Set([...membersOf(s), target]), ranged: new Set(), anchor: target };
  // what the old range covered that this order cannot see was not un-chosen by a fold: it settles
  const outOfSight = [...s.ranged].filter((id) => !order.includes(id));
  return {
    picked: new Set([...s.picked, ...outOfSight]),
    ranged: new Set(order.slice(Math.min(from, to), Math.max(from, to) + 1)),
    anchor: s.anchor,
  };
}

/** Where a shifted arrow takes the end of the range: one step along the range order, stopping at its ends. */
export function stepFrom(order: readonly number[], at: number | null, step: 1 | -1): number | null {
  if (order.length === 0) return null;
  const index = at === null ? -1 : order.indexOf(at);
  if (index === -1) return order[0]!;
  return order[Math.max(0, Math.min(index + step, order.length - 1))]!;
}

/** Every Ticket under the current Filter, folded columns included. The anchor is whatever it was. */
export const selectAll = (s: Selection, ids: readonly number[]): Selection => ({ picked: new Set(ids), ranged: new Set(), anchor: s.anchor });

/**
 * A Ticket that leaves the Filter leaves the Selection — a poll dropped it, or
 * the Filter changed. The same object comes back when nothing left, so a quiet
 * poll is not a state change.
 */
export function reconcile(s: Selection, live: ReadonlySet<number>): Selection {
  const keep = (set: ReadonlySet<number>) => new Set([...set].filter((id) => live.has(id)));
  const picked = keep(s.picked);
  const ranged = keep(s.ranged);
  const anchor = s.anchor !== null && live.has(s.anchor) ? s.anchor : null;
  if (picked.size === s.picked.size && ranged.size === s.ranged.size && anchor === s.anchor) return s;
  return { picked, ranged, anchor };
}
