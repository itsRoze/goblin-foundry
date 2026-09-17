import { describe, expect, test } from 'bun:test';
import { EMPTY_SELECTION, membersOf, rangeOrder, rangeTo, reconcile, selectAll, stepFrom, toggle, type Selection } from '../src/selection';

/**
 * A Selection is a set of Ticket ids (CONTEXT.md "Selection"), and everything
 * subtle about it is about ranges: where one starts, what it crosses, and what
 * it leaves alone. The browser suite proves the gestures reach this; these
 * prove what the gestures mean.
 */

/** backlog · todo · planning, as ids, top to bottom. */
const columns = [
  { status: 'backlog', ids: [1, 2, 3] },
  { status: 'todo', ids: [4] },
  { status: 'planning', ids: [5, 6] },
] as const;
const order = rangeOrder(columns, () => true);

const ids = (s: Selection) => [...membersOf(s)].sort((a, b) => a - b);

describe('toggle', () => {
  test('selecting a ticket makes it the anchor; deselecting it leaves no anchor behind', () => {
    const one = toggle(EMPTY_SELECTION, 2);
    expect(ids(one)).toEqual([2]);
    expect(one.anchor).toBe(2);
    const none = toggle(one, 2);
    expect(ids(none)).toEqual([]);
    expect(none.anchor).toBeNull();
  });

  test('the most recent individual selection is the anchor', () => {
    const s = toggle(toggle(EMPTY_SELECTION, 2), 5);
    expect(s.anchor).toBe(5);
    expect(ids(rangeTo(s, order, 6))).toEqual([2, 5, 6]);
  });
});

describe('rangeTo', () => {
  test('with no anchor it selects that one ticket and makes it the anchor', () => {
    const s = rangeTo(EMPTY_SELECTION, order, 4);
    expect(ids(s)).toEqual([4]);
    expect(s.anchor).toBe(4);
  });

  test('a range includes both ends and runs in lifecycle order across columns, whichever way it was drawn', () => {
    expect(ids(rangeTo(toggle(EMPTY_SELECTION, 2), order, 5))).toEqual([2, 3, 4, 5]);
    expect(ids(rangeTo(toggle(EMPTY_SELECTION, 5), order, 2))).toEqual([2, 3, 4, 5]);
  });

  test('a second range from the same anchor replaces the first — extending and contracting — and the anchor stays put', () => {
    const anchored = toggle(EMPTY_SELECTION, 2);
    const long = rangeTo(anchored, order, 6);
    expect(ids(long)).toEqual([2, 3, 4, 5, 6]);
    const short = rangeTo(long, order, 3);
    expect(ids(short)).toEqual([2, 3]);
    expect(short.anchor).toBe(2);
    // and through the anchor to the other side
    expect(ids(rangeTo(short, order, 1))).toEqual([1, 2]);
  });

  test('tickets chosen one by one survive a range drawn over them and then taken back', () => {
    const picked = toggle(toggle(EMPTY_SELECTION, 5), 2);
    const over = rangeTo(picked, order, 6);
    expect(ids(over)).toEqual([2, 3, 4, 5, 6]);
    expect(ids(rangeTo(over, order, 3))).toEqual([2, 3, 5]);
  });

  test('toggling after a range keeps what the range gathered', () => {
    const ranged = rangeTo(toggle(EMPTY_SELECTION, 1), order, 3);
    const plus = toggle(ranged, 6);
    expect(ids(plus)).toEqual([1, 2, 3, 6]);
    // deselecting a ticket the range gathered takes only that ticket out
    expect(ids(toggle(plus, 2))).toEqual([1, 3, 6]);
  });

  test('a folded column is skipped by a new range, and what was already selected in it stays', () => {
    const open = (status: string) => status !== 'todo';
    const folded = rangeOrder(columns, open);
    expect(folded).toEqual([1, 2, 3, 5, 6]);
    const before = toggle(toggle(EMPTY_SELECTION, 4), 2);
    const s = rangeTo(before, folded, 6);
    // 4 was chosen before the fold and is kept; the range itself never reaches into `todo`
    expect(ids(s)).toEqual([2, 3, 4, 5, 6]);
    expect(ids(rangeTo(toggle(EMPTY_SELECTION, 2), folded, 6))).toEqual([2, 3, 5, 6]);
  });

  test('a range that ran through a column keeps those tickets when the column folds and the range is redrawn', () => {
    const ranged = rangeTo(toggle(EMPTY_SELECTION, 3), order, 5);
    expect(ids(ranged)).toEqual([3, 4, 5]);
    const folded = rangeOrder(columns, (status) => status !== 'todo');
    expect(ids(rangeTo(ranged, folded, 6))).toEqual([3, 4, 5, 6]);
  });

  test('an anchor the board can no longer reach is no anchor', () => {
    const anchored = toggle(EMPTY_SELECTION, 4);
    const folded = rangeOrder(columns, (status) => status !== 'todo');
    const s = rangeTo(anchored, folded, 6);
    expect(ids(s)).toEqual([4, 6]);
    expect(s.anchor).toBe(6);
  });
});

describe('stepFrom', () => {
  test('walks the same order a range follows, across column ends, and stops at the board’s', () => {
    expect(stepFrom(order, 3, 1)).toBe(4);
    expect(stepFrom(order, 4, -1)).toBe(3);
    expect(stepFrom(order, 6, 1)).toBe(6);
    expect(stepFrom(order, 1, -1)).toBe(1);
  });

  test('from nowhere it lands on the first card', () => {
    expect(stepFrom(order, null, 1)).toBe(1);
    expect(stepFrom(order, 99, -1)).toBe(1);
    expect(stepFrom([], null, 1)).toBeNull();
  });
});

describe('selectAll and reconcile', () => {
  test('select all takes every ticket it is given, folded or not', () => {
    expect(ids(selectAll(toggle(EMPTY_SELECTION, 2), [1, 2, 3, 4, 5, 6]))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('a ticket that leaves the filter leaves the selection, and takes the anchor with it if it was one', () => {
    const s = rangeTo(toggle(toggle(EMPTY_SELECTION, 6), 2), order, 4);
    const after = reconcile(s, new Set([1, 3, 4, 6]));
    expect(ids(after)).toEqual([3, 4, 6]);
    expect(after.anchor).toBeNull();
  });

  test('a poll that changes nothing hands back the same selection', () => {
    const s = toggle(EMPTY_SELECTION, 2);
    expect(reconcile(s, new Set([1, 2, 3]))).toBe(s);
  });
});
