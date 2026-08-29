import { describe, expect, test } from 'bun:test';
import { TICKET_STATUSES, type TicketStatus } from '../src/tickets';
import { TRANSITIONS, approveGuard, destinationOf, findTransition, guardRefusal, structuralRefusal, transitionTo, transitionsFrom, type GuardFields } from '../src/transitions';

/**
 * ADR-0003's table, transcribed by hand as one flat arrow per line — a
 * different shape from the `{name, from[]}` rows the table is built from, so
 * this compares the lifecycle to the decision rather than to itself.
 */
const ADR_0003 = `
backlog   -pick->      todo
planning  -pick->      todo
backlog   -plan->      planning
todo      -plan->      planning
todo      -shelve->    backlog
planning  -shelve->    backlog
todo      -approve->   ready
planning  -approve->   ready
ready     -unapprove-> planning
ready     -start->     building
building  -stop->      ready
building  -submit->    review
review    -ship->      done
backlog   -close->     done
todo      -close->     done
planning  -close->     done
ready     -close->     done
building  -close->     done
backlog   -cancel->    cancelled
todo      -cancel->    cancelled
planning  -cancel->    cancelled
ready     -cancel->    cancelled
building  -cancel->    cancelled
review    -cancel->    cancelled
done      -cancel->    cancelled
cancelled -reopen->    backlog
`;

const arrows = (lines: string[]) => lines.map((l) => l.trim().split(/\s+/).join(' ')).filter(Boolean).sort();

describe('the transition table is ADR-0003', () => {
  test('every edge in the ADR is in the table and no others (26 edges)', () => {
    const fromTable = TRANSITIONS.map((t) => `${t.from} -${t.name}-> ${t.to}`);
    expect(arrows(fromTable)).toEqual(arrows(ADR_0003.trim().split('\n')));
    expect(TRANSITIONS).toHaveLength(26);
  });

  test('`approve` is the only guarded edge — the ADR marks that one and no other', () => {
    expect(TRANSITIONS.filter((t) => t.guard).map((t) => `${t.from} ${t.name}`)).toEqual(['todo approve', 'planning approve']);
  });

  test('the destination a refused drag names is the one the ADR gives that verb', () => {
    expect(destinationOf('start')).toBe('building');
    expect(destinationOf('ship')).toBe('done');
    expect(destinationOf('reopen')).toBe('backlog');
  });

  test('(from, name) addresses exactly one edge, and so does (from, to) in S1', () => {
    const byName = new Set(TRANSITIONS.map((t) => `${t.from}/${t.name}`));
    const byTarget = new Set(TRANSITIONS.map((t) => `${t.from}/${t.to}`));
    expect(byName.size).toBe(TRANSITIONS.length);
    expect(byTarget.size).toBe(TRANSITIONS.length);
  });

  test('there is no way back into building from review, and no self-edge anywhere', () => {
    expect(findTransition('review', 'start')).toBeUndefined();
    expect(transitionTo('review', 'building')).toBeUndefined();
    expect(TRANSITIONS.filter((t) => t.from === t.to)).toEqual([]);
  });

  test('every status but cancelled can be cancelled; a cancelled ticket only reopens', () => {
    for (const status of TICKET_STATUSES) {
      const names = transitionsFrom(status).map((t) => t.name);
      if (status === 'cancelled') expect(names).toEqual(['reopen']);
      else expect(names).toContain('cancel');
    }
  });
});

describe('the approve guard', () => {
  const ticket = (over: Partial<GuardFields> = {}): GuardFields => ({ app_id: 1, simple: false, design: 'a plan', ...over });

  test('an app and a design satisfy it', () => {
    expect(approveGuard(ticket())).toEqual([]);
  });

  test('it names each missing thing, and both when both are missing', () => {
    expect(approveGuard(ticket({ design: null }))).toEqual(['design']);
    expect(approveGuard(ticket({ app_id: null }))).toEqual(['app']);
    expect(approveGuard(ticket({ app_id: null, design: '   ' }))).toEqual(['app', 'design']);
  });

  test('a whitespace-only design is no design', () => {
    expect(approveGuard(ticket({ design: ' \n\t ' }))).toEqual(['design']);
  });

  test('simple drops the design requirement but never the app — an orphan can never be ready', () => {
    expect(approveGuard(ticket({ simple: true, design: null }))).toEqual([]);
    expect(approveGuard(ticket({ simple: true, design: null, app_id: null }))).toEqual(['app']);
  });

  test('a description is not part of the guard', () => {
    expect(approveGuard({ app_id: 1, simple: true, design: null })).toEqual([]);
  });
});

describe('refusal sentences', () => {
  test('a structural refusal is generated from the status pair', () => {
    expect(structuralRefusal('review', 'building')).toBe('a ticket in review does not go back to building');
    expect(structuralRefusal('done', 'ready')).toBe('a ticket in done does not go back to ready');
    expect(structuralRefusal('backlog', 'review')).toBe('a ticket in backlog does not go to review');
  });

  test('moving a ticket to the status it is already in says so', () => {
    const status: TicketStatus = 'ready';
    expect(structuralRefusal(status, status)).toBe('a ticket in ready is already in ready');
  });

  test('a guard refusal names what is missing', () => {
    expect(guardRefusal('approve', ['design'])).toBe('approve needs a ticket design');
    expect(guardRefusal('approve', ['app', 'design'])).toBe('approve needs an app and a ticket design');
  });
});
