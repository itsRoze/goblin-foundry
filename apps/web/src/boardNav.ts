export interface NavStatus {
  id: string;
}

export interface NavTicket {
  id: string;
  statusId: string;
}

/** Flattens the board's rendering order (status order, then per-status list order)
    into a single sequence of ticket ids, so j/k walk the board in reading order. */
export function navigationOrder(statuses: NavStatus[], tickets: NavTicket[]): string[] {
  return statuses.flatMap(status => tickets.filter(t => t.statusId === status.id).map(t => t.id));
}

export function nextFocusedId(order: string[], focusedId: string | null): string | null {
  if (focusedId === null) return order[0] ?? null;
  const i = order.indexOf(focusedId);
  if (i === -1 || i === order.length - 1) return focusedId;
  return order[i + 1]!;
}

export function prevFocusedId(order: string[], focusedId: string | null): string | null {
  if (focusedId === null) return null;
  const i = order.indexOf(focusedId);
  if (i <= 0) return focusedId;
  return order[i - 1]!;
}

/** Keeps focus on the same ticket across data changes, clearing it if that ticket is gone. */
export function reconcileFocus(order: string[], focusedId: string | null): string | null {
  if (focusedId === null) return null;
  return order.includes(focusedId) ? focusedId : null;
}

export interface NavKeyEvent {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: { tagName?: string; isContentEditable?: boolean } | null;
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA']);

/** True when a j/k/Enter keystroke should be left alone: it carries a modifier,
    or it originated from a text input, textarea, or contentEditable element. */
export function isNavKeyIgnored(e: NavKeyEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  const target = e.target;
  if (!target) return false;
  return EDITABLE_TAGS.has(target.tagName ?? '') || target.isContentEditable === true;
}
