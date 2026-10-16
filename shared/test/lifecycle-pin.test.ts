import { describe, expect, test } from 'bun:test';
import { TICKET_STATUSES } from '../src/tickets';
import { TRANSITIONS, TRANSITION_NAMES, TRANSITION_OWNERS, judgeTransition, structuralRefusal, transitionTo, type GuardFields } from '../src/transitions';

/**
 * Everything the lifecycle answers, one line per fact, pinned in
 * `__snapshots__` before the engine moves into `@goblin/workflow` (GF-38).
 * The snapshot never changes; only what produces each line does.
 */

const FIXTURES: Record<'lacking' | 'satisfied', GuardFields> = {
  lacking: { app_id: null, simple: false, design: null },
  satisfied: { app_id: 1, simple: false, design: '# plan' },
};

describe('the lifecycle, pinned', () => {
  test('every edge, in table order', () => {
    expect(TRANSITIONS.map((t) => `${t.from} -${t.name}-> ${t.to} ${t.owner}${t.guard ? ' guarded' : ''}`)).toMatchSnapshot();
  });

  test('every (status, name, actor), judged on a ticket lacking everything and on one with everything', () => {
    const lines: string[] = [];
    for (const status of TICKET_STATUSES)
      for (const name of TRANSITION_NAMES)
        for (const actor of TRANSITION_OWNERS)
          for (const [fixture, fields] of Object.entries(FIXTURES)) {
            const judged = judgeTransition({ ...fields, status }, name, actor);
            // a refusal as the API puts it on the wire, where a refusal with no owner is the human's (`conflict`)
            lines.push(`${status} ${name} ${actor} ${fixture}: ${judged.ok ? `-> ${judged.edge.to}` : `409 ${judged.owner ?? 'human'} ${judged.reason}`}`);
          }
    expect(lines).toMatchSnapshot();
  });

  test('every (from, to) pair: the arrow a drop takes, or the sentence refusing it', () => {
    const lines = TICKET_STATUSES.flatMap((from) =>
      TICKET_STATUSES.map((to) => {
        const edge = transitionTo(from, to);
        return `${from} -> ${to}: ${edge ? edge.name : structuralRefusal(from, to)}`;
      }),
    );
    expect(lines).toMatchSnapshot();
  });
});
