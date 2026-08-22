import { STATUS_KINDS, type StatusKind } from './types.ts';

/**
 * Status kinds that do not block a dependent ticket. A canceled blocker is not
 * a permanent wedge, and a done blocker is finished.
 */
export const UNBLOCKING_KINDS: ReadonlySet<StatusKind> = new Set(['done', 'canceled']);

export function isUnblockingKind(kind: StatusKind): boolean {
  return UNBLOCKING_KINDS.has(kind);
}

export type WithStatusKind = { status?: { kind: StatusKind } | null };

/**
 * The one readiness rule shared by the board and the worker's claim query.
 * A ticket is ready iff it has no blocker whose status kind is not done/canceled.
 */
export function ticketReadiness<T extends WithStatusKind>(
  blockers: readonly T[],
): { ready: true } | { ready: false; unfinished: T[] } {
  const unfinished = blockers.filter(b => !b.status || !isUnblockingKind(b.status.kind));
  if (unfinished.length === 0) return { ready: true };
  return { ready: false, unfinished };
}

/** Convenience: the blocker refs to render on a card, naming why it is stuck. */
export function unfinishedBlockers<T extends WithStatusKind>(blockers: readonly T[]): T[] {
  const r = ticketReadiness(blockers);
  return r.ready ? [] : r.unfinished;
}

/** Kinds ordered the board renders columns in, regardless of project. */
export function canonicalKindOrder(): readonly StatusKind[] {
  return STATUS_KINDS;
}
