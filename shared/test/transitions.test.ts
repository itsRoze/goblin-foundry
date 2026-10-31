import { describe, expect, test } from 'bun:test';
import { TICKET_STATUSES } from '../src/tickets';
import { approveGuard, guardHold, lifecycle, type GuardFields } from '../src/transitions';

/**
 * ADR-0003's table, transcribed by hand as one flat arrow per line — a
 * different shape from the `{from[], to}` rows the lifecycle is built from, so
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

const ticket = (over: Partial<GuardFields> = {}): GuardFields => ({ app_id: 1, simple: false, design: 'a plan', description: '', ...over });

describe('the lifecycle is ADR-0003', () => {
  test('every edge in the ADR is in the table and no others (26 edges)', () => {
    const fromTable = lifecycle.edges.map((t) => `${t.from} -${t.name}-> ${t.to}`);
    expect(arrows(fromTable)).toEqual(arrows(ADR_0003.trim().split('\n')));
    expect(lifecycle.edges).toHaveLength(26);
  });

  test('`approve` is the only guarded edge — the ADR marks that one and no other', () => {
    expect(lifecycle.edges.filter((t) => t.guarded).map((t) => `${t.from} ${t.name}`)).toEqual(['todo approve', 'planning approve']);
  });

  test('there is no way back into building from review, and no self-edge anywhere', () => {
    expect(lifecycle.named('review', 'start')).toEqual({ ok: false, refusal: 'a ticket in review does not go back to building' });
    expect(lifecycle.toward('review', 'building')).toEqual({ ok: false, refusal: 'a ticket in review does not go back to building' });
    expect(lifecycle.edges.filter((t) => t.from === t.to)).toEqual([]);
  });

  test('every status but cancelled can be cancelled; a cancelled ticket only reopens', () => {
    for (const status of TICKET_STATUSES) {
      const names = lifecycle.from(status).map((t) => t.name);
      if (status === 'cancelled') expect(names).toEqual(['reopen']);
      else expect(names).toContain('cancel');
    }
  });

  test('either Actor takes every arrow (ADR-0012)', () => {
    for (const edge of lifecycle.edges)
      for (const actor of ['human', 'agent'] as const) {
        const judged = lifecycle.judge({ ...ticket({ simple: true }), status: edge.from }, edge.name, actor);
        expect([edge.from, edge.name, actor, judged.ok]).toEqual([edge.from, edge.name, actor, true]);
      }
  });
});

describe('the approve guard', () => {
  test('an app and a design satisfy it', () => {
    expect(approveGuard(ticket())).toEqual([]);
  });

  test('an app and a description satisfy it, with no design and no simple flag', () => {
    expect(approveGuard(ticket({ design: null, description: 'what to build' }))).toEqual([]);
  });

  test('it names each missing thing, and both when both are missing', () => {
    expect(approveGuard(ticket({ design: null }))).toEqual(['intent']);
    expect(approveGuard(ticket({ app_id: null }))).toEqual(['app']);
    expect(approveGuard(ticket({ app_id: null, design: '   ' }))).toEqual(['app', 'intent']);
  });

  test('a whitespace-only design or description is none', () => {
    expect(approveGuard(ticket({ design: ' \n\t ' }))).toEqual(['intent']);
    expect(approveGuard(ticket({ design: null, description: ' \n\t ' }))).toEqual(['intent']);
  });

  test('simple drops the intent requirement but never the app — an orphan can never be ready', () => {
    expect(approveGuard(ticket({ simple: true, design: null }))).toEqual([]);
    expect(approveGuard(ticket({ simple: true, design: null, app_id: null }))).toEqual(['app']);
  });

  test('it holds where a ticket stands at `ready` or beyond, and not below', () => {
    expect(lifecycle.missingAt('ready', ticket({ app_id: null, simple: true, design: null }))).toEqual(['app']);
    expect(lifecycle.missingAt('review', ticket({ design: null }))).toEqual(['intent']);
    expect(lifecycle.missingAt('planning', ticket({ app_id: null, design: null }))).toEqual([]);
  });
});

describe('refusal sentences', () => {
  test('a structural refusal is generated from the status pair', () => {
    expect(lifecycle.toward('review', 'building')).toEqual({ ok: false, refusal: 'a ticket in review does not go back to building' });
    expect(lifecycle.toward('done', 'ready')).toEqual({ ok: false, refusal: 'a ticket in done does not go back to ready' });
    expect(lifecycle.toward('backlog', 'review')).toEqual({ ok: false, refusal: 'a ticket in backlog does not go to review' });
  });

  test('moving a ticket to the status it is already in says so', () => {
    expect(lifecycle.toward('ready', 'ready')).toEqual({ ok: false, refusal: 'a ticket in ready is already in ready' });
  });

  test('a guard refusal names what is missing, and whose move it was', () => {
    expect(lifecycle.judge({ ...ticket({ design: null }), status: 'planning' }, 'approve', 'human')).toEqual({ ok: false, refusal: 'approve needs a description or a ticket design', owner: 'human' });
    expect(lifecycle.judge({ ...ticket({ app_id: null, design: null }), status: 'todo' }, 'approve', 'human')).toEqual({
      ok: false,
      refusal: 'approve needs an app and a description or a ticket design',
      owner: 'human',
    });
  });

  test('the same words hold a ticket that is standing there rather than walking in', () => {
    expect(guardHold('ready', ['app'])).toBe('a ticket in ready needs an app');
    expect(guardHold('ready', ['app', 'intent'])).toBe('a ticket in ready needs an app and a description or a ticket design');
  });
});

/**
 * A drag names a destination column and a key names the verb, so the two ask
 * the lifecycle different questions — and both the board's `a` and the Ticket
 * view's `a` have to answer with the same sentence (issue 10).
 */
describe('a named move', () => {
  test('hands back the arrow when the table has one out of here', () => {
    expect(lifecycle.named('planning', 'approve')).toEqual({ ok: true, edge: { from: 'planning', to: 'ready', name: 'approve', owner: 'human', direction: 'forward', guarded: true } });
  });

  test('refuses by the verb, naming where that verb would have gone', () => {
    // `ready` has no `approve` arrow, and `stop` also lands in `ready` — so the pair alone could not say this
    expect(lifecycle.named('ready', 'approve')).toEqual({ ok: false, refusal: 'a ticket in ready is already in ready' });
    expect(lifecycle.named('building', 'approve')).toEqual({ ok: false, refusal: 'a ticket in building does not go back to ready' });
    expect(lifecycle.named('backlog', 'approve')).toEqual({ ok: false, refusal: 'a ticket in backlog does not go to ready' });
  });
});
