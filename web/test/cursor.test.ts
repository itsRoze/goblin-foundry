import { describe, expect, test } from 'bun:test';
import { firstSpot, moveCursor, stillThere } from '../src/cursor';

/**
 * The Cursor is keyed by ticket key, never by index (CONTEXT.md "Cursor"), so
 * everything worth proving about it is a pure question about a board shaped as
 * columns of keys: where a move lands, where it refuses to go, and what
 * happens when the card under it leaves.
 */

/** backlog · todo · planning, as the board hands them over. */
const board = [
  ['GF-1', 'GF-2', 'GF-3'],
  ['GF-4'],
  ['GF-5', 'GF-6'],
];

describe('moveCursor', () => {
  test('the first press lands on the first card of the first non-empty column', () => {
    expect(moveCursor([[], ['GF-4'], ['GF-5']], null, 'j')).toBe('GF-4');
    // any of the four puts a cursor on screen; there is nothing to move from yet
    for (const move of ['j', 'k', 'h', 'l'] as const) expect(moveCursor(board, null, move)).toBe('GF-1');
  });

  test('j and k move within a column and stop at its ends', () => {
    expect(moveCursor(board, 'GF-1', 'j')).toBe('GF-2');
    expect(moveCursor(board, 'GF-3', 'j')).toBe('GF-3');
    expect(moveCursor(board, 'GF-2', 'k')).toBe('GF-1');
    expect(moveCursor(board, 'GF-1', 'k')).toBe('GF-1');
  });

  test('h and l cross to the same row of the neighbouring column', () => {
    expect(moveCursor(board, 'GF-1', 'l')).toBe('GF-4');
    expect(moveCursor(board, 'GF-4', 'h')).toBe('GF-1');
    expect(moveCursor(board, 'GF-6', 'h')).toBe('GF-4');
  });

  test('a shorter neighbour clamps to its last card rather than refusing the move', () => {
    // row 2 of `backlog` has no opposite number in `todo`, which holds one card
    expect(moveCursor(board, 'GF-3', 'l')).toBe('GF-4');
  });

  test('an empty column is skipped, not landed in', () => {
    const gappy = [['GF-1'], [], ['GF-5', 'GF-6']];
    expect(moveCursor(gappy, 'GF-1', 'l')).toBe('GF-5');
    expect(moveCursor(gappy, 'GF-5', 'h')).toBe('GF-1');
  });

  test('the outermost column has nowhere further to go', () => {
    expect(moveCursor(board, 'GF-1', 'h')).toBe('GF-1');
    expect(moveCursor(board, 'GF-5', 'l')).toBe('GF-5');
  });

  test('a card that has left the board hands the cursor back to the first one', () => {
    // the poll dropped GF-2 (a filter, a trash, another window): the key is no longer anywhere
    expect(moveCursor(board, 'GF-99', 'j')).toBe('GF-1');
    expect(moveCursor([[], [], []], 'GF-1', 'j')).toBeNull();
  });

  test('a transition that moves a card carries the cursor with it', () => {
    // GF-2 was approved: same key, different column, and `j` still moves from where it now is
    const after = [
      ['GF-1', 'GF-3'],
      ['GF-4'],
      ['GF-5', 'GF-2'],
    ];
    expect(stillThere(after, 'GF-2')).toBe('GF-2');
    expect(moveCursor(after, 'GF-2', 'k')).toBe('GF-5');
  });
});

describe('stillThere', () => {
  test('keeps a key the board still holds and drops one it does not', () => {
    expect(stillThere(board, 'GF-6')).toBe('GF-6');
    expect(stillThere(board, 'GF-99')).toBeNull();
    expect(stillThere(board, null)).toBeNull();
  });
});

describe('firstSpot', () => {
  test('is the first card of the first non-empty column, or nothing at all', () => {
    expect(firstSpot([[], ['GF-4', 'GF-9']])).toBe('GF-4');
    expect(firstSpot([[], []])).toBeNull();
  });
});
