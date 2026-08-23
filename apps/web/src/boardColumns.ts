import { STATUS_KINDS, type StatusKind } from '@goblin/schema';

export type BoardStatusRow = {
  id: string;
  kind: StatusKind;
  name: string;
  color: string;
  enabled: boolean;
};

export type BoardColumn = {
  kind: StatusKind;
  name: string;
  color: string;
  statusIds: string[];
};

/**
 * Group status rows by canonical kind so the board shows one column per kind,
 * ordered by the canonical order. Display name and colour come from any enabled
 * row of that kind; a disabled kind contributes no column.
 */
export function boardColumns(statuses: readonly BoardStatusRow[]): BoardColumn[] {
  const byKind = new Map<StatusKind, { name: string; color: string; ids: string[] }>();
  for (const s of statuses) {
    if (!s.enabled) continue;
    const existing = byKind.get(s.kind);
    if (existing) {
      existing.ids.push(s.id);
    } else {
      byKind.set(s.kind, { name: s.name, color: s.color, ids: [s.id] });
    }
  }
  return STATUS_KINDS.filter(k => byKind.has(k)).map(k => {
    const col = byKind.get(k)!;
    return { kind: k, name: col.name, color: col.color, statusIds: col.ids };
  });
}

/** True when a ticket belongs to a column (its status id is one of the column's ids). */
export function ticketInColumn(ticket: { statusId: string }, column: { statusIds: string[] }): boolean {
  return column.statusIds.includes(ticket.statusId);
}
