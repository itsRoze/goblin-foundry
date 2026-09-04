/**
 * Where the Cursor is, and where a key moves it (CONTEXT.md "Cursor").
 *
 * The board is handed over as columns of row ids, and the answer is always
 * another id — never an index. That is the whole reason this module is worth
 * having: a cursor held by key survives the board's 5 s poll, follows a card
 * that a transition moves to another column, and lets go by itself when the
 * card leaves the board. A row tile is a board with one column, so the same
 * four moves serve the kanban and every list of rows.
 */

/**
 * The board as the cursor sees it: columns of row ids, in the order they are
 * drawn. On every tile whose rows are Tickets the id *is* the Ticket Key,
 * which is the promise CONTEXT.md makes about the Cursor; the all-apps and
 * all-projects lists have no keys, so there the id is the row's own path.
 */
export type Columns = readonly (readonly string[])[];

/** `j` down, `k` up, `h` left, `l` right — the arrows are aliases of these (DESIGN.md Interaction). */
export type Move = 'j' | 'k' | 'h' | 'l';

const clamp = (n: number, last: number) => Math.max(0, Math.min(n, last));

/** Which column the key is in and how far down it, or `null` when the board no longer holds it. */
function spotOf(columns: Columns, at: string): { col: number; row: number } | null {
  for (let col = 0; col < columns.length; col += 1) {
    const row = columns[col]!.indexOf(at);
    if (row !== -1) return { col, row };
  }
  return null;
}

/** The first card of the first non-empty column — where a cursor appears from nothing. */
export function firstSpot(columns: Columns): string | null {
  for (const column of columns) if (column.length > 0) return column[0]!;
  return null;
}

/** The key if the board still holds it, else nothing: what a poll or a filter leaves behind. */
export function stillThere(columns: Columns, at: string | null): string | null {
  return at !== null && spotOf(columns, at) !== null ? at : null;
}

/** The next non-empty column in that direction, or `null` when this is the outermost one. */
function neighbour(columns: Columns, col: number, step: 1 | -1): number | null {
  for (let i = col + step; i >= 0 && i < columns.length; i += step) if (columns[i]!.length > 0) return i;
  return null;
}

/**
 * Where the cursor lands. With no cursor — on load, or once the card under it
 * has left the board — any of the four puts one on screen rather than doing
 * nothing, because a key that appears to be dead is worse than a key that
 * starts you at the top. `j/k` stop at the ends of their column and `h/l` at
 * the outermost non-empty one: this is a cursor over a fixed lifecycle, and
 * wrapping would move it somewhere nobody was pointing.
 */
export function moveCursor(columns: Columns, at: string | null, move: Move): string | null {
  const spot = at === null ? null : spotOf(columns, at);
  if (spot === null) return firstSpot(columns);
  const column = columns[spot.col]!;
  if (move === 'j' || move === 'k') return column[clamp(spot.row + (move === 'j' ? 1 : -1), column.length - 1)]!;
  const col = neighbour(columns, spot.col, move === 'l' ? 1 : -1);
  if (col === null) return at;
  // a shorter neighbour clamps to its last card: the move always lands somewhere
  return columns[col]![clamp(spot.row, columns[col]!.length - 1)]!;
}
