import type { TicketStatus } from '@goblin/shared';
import type { Columns } from './cursor';

/**
 * The vertical board (issue 11): below the orientation breakpoint the kanban's
 * columns become stacked sections, each folded or open on its own. Which are
 * open is *presentation* — per device, remembered across visits, and nothing
 * to do with the Filter, the address, the Cursor or the Selection. A folded
 * section still counts its tickets; it is never a status filter in disguise.
 */

/** Which way the board is drawn: the kanban, or its columns stacked. */
export type Orientation = 'horizontal' | 'vertical';

/** The choices this device has made, and nothing more: a status not named here shows its default. */
export type Expansion = Partial<Record<TicketStatus, boolean>>;

/**
 * A clean device opens the work in hand and folds what is queued or finished:
 * `planning`, `ready`, `building` and `review` are the statuses someone
 * triaging on a phone is triaging *between*. `cancelled` folds like `done`;
 * it is on the board only when the Filter names it, and it is the quieter of
 * the two.
 */
const DEFAULT_EXPANDED: Record<TicketStatus, boolean> = {
  backlog: false,
  todo: false,
  planning: true,
  ready: true,
  building: true,
  review: true,
  done: false,
  cancelled: false,
};

export const isExpanded = (expansion: Expansion, status: TicketStatus): boolean => expansion[status] ?? DEFAULT_EXPANDED[status];

/** The choice for one section, recorded; the rest are left as they were. */
export const toggleSection = (expansion: Expansion, status: TicketStatus): Expansion => ({ ...expansion, [status]: !isExpanded(expansion, status) });

/**
 * The board as the Cursor sees it. Horizontal: one column per status, as
 * always. Vertical: *one* column of every card that is on screen, top to
 * bottom, so `j/k` walk the page the way the eye does — and a card in a folded
 * section is not there at all, because a Cursor on a card you cannot see is an
 * armed control with no readout (issue 10).
 */
export function cursorColumns(orientation: Orientation, drawn: readonly { status: TicketStatus; keys: readonly string[] }[], expansion: Expansion): Columns {
  if (orientation === 'horizontal') return drawn.map((column) => column.keys);
  return [drawn.filter((column) => isExpanded(expansion, column.status)).flatMap((column) => [...column.keys])];
}

/** Where a moved card ends up from the reader's point of view — which decides whether the board has to say so. */
export type Landing = 'shown' | 'collapsed' | 'off-board';

export function landing({
  to,
  columns,
  vertical,
  expansion,
}: {
  to: TicketStatus;
  /** The statuses the Filter puts on the board. */
  columns: readonly TicketStatus[];
  vertical: boolean;
  expansion: Expansion;
}): Landing {
  if (!columns.includes(to)) return 'off-board';
  if (vertical && !isExpanded(expansion, to)) return 'collapsed';
  return 'shown';
}
