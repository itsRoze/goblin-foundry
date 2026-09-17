import { describe, expect, test } from 'bun:test';
import { cursorColumns, isExpanded, landing, toggleSection, type Expansion } from '../src/sections';

/**
 * The vertical board's sections (issue 11): which are open, what the Cursor
 * can walk, and where a moved card ends up from the reader's point of view.
 * Pure questions, so they are asked here rather than in a browser.
 */

const drawn = [
  { status: 'backlog', keys: ['GF-1', 'GF-2'] },
  { status: 'planning', keys: ['GF-3'] },
  { status: 'done', keys: ['GF-4'] },
] as const;

describe('isExpanded', () => {
  test('a clean device opens the working statuses and folds the rest', () => {
    const none: Expansion = {};
    for (const status of ['planning', 'ready', 'building', 'review'] as const) expect(isExpanded(none, status)).toBe(true);
    for (const status of ['backlog', 'todo', 'done', 'cancelled'] as const) expect(isExpanded(none, status)).toBe(false);
  });

  test('a remembered choice wins over the default, in either direction', () => {
    expect(isExpanded({ backlog: true }, 'backlog')).toBe(true);
    expect(isExpanded({ ready: false }, 'ready')).toBe(false);
  });
});

describe('toggleSection', () => {
  test('toggling records the opposite of what is shown, and leaves the other sections alone', () => {
    expect(toggleSection({}, 'backlog')).toEqual({ backlog: true });
    expect(toggleSection({ backlog: true }, 'backlog')).toEqual({ backlog: false });
    expect(toggleSection({ done: true }, 'ready')).toEqual({ done: true, ready: false });
  });
});

describe('cursorColumns', () => {
  test('a horizontal board is one column per status, collapsed or not', () => {
    expect(cursorColumns('horizontal', drawn, {})).toEqual([['GF-1', 'GF-2'], ['GF-3'], ['GF-4']]);
  });

  test('a vertical board is one column of the cards that are on screen, in reading order', () => {
    // planning is open by default; backlog and done are folded, so their cards are not somewhere a key can point
    expect(cursorColumns('vertical', drawn, {})).toEqual([['GF-3']]);
    expect(cursorColumns('vertical', drawn, { backlog: true })).toEqual([['GF-1', 'GF-2', 'GF-3']]);
  });
});

describe('landing', () => {
  const columns = ['backlog', 'planning', 'done'] as const;

  test('a destination the filter leaves off is off the board at any width', () => {
    expect(landing({ to: 'cancelled', columns, vertical: false, expansion: {} })).toBe('off-board');
    expect(landing({ to: 'cancelled', columns, vertical: true, expansion: { cancelled: true } })).toBe('off-board');
  });

  test('on a horizontal board every column is in view, so a card that stays on the board is shown', () => {
    expect(landing({ to: 'done', columns, vertical: false, expansion: {} })).toBe('shown');
  });

  test('on a vertical board a folded section takes the card out of sight', () => {
    expect(landing({ to: 'done', columns, vertical: true, expansion: {} })).toBe('collapsed');
    expect(landing({ to: 'done', columns, vertical: true, expansion: { done: true } })).toBe('shown');
    expect(landing({ to: 'planning', columns, vertical: true, expansion: {} })).toBe('shown');
  });
});
