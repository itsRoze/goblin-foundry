import { describe, expect, test } from 'bun:test';
import { TICKET_STATUSES } from '../src/tickets';
import { decidingOwner, lifecycle, type GuardFields } from '../src/transitions';

const FIXTURES: Record<'lacking' | 'satisfied', GuardFields> = {
  lacking: { app_id: null, simple: false, design: null, description: '' },
  satisfied: { app_id: 1, simple: false, design: '# plan', description: '' },
};

describe('the lifecycle, pinned', () => {
  // an owner every Actor holds the authority of decides nothing, so it is written `either`
  test('every edge, in table order', () => {
    expect(lifecycle.edges.map((t) => `${t.from} -${t.name}-> ${t.to} ${decidingOwner(t.owner) ?? 'either'}${t.guarded ? ' guarded' : ''}`)).toMatchSnapshot();
  });

  test('every (status, name, actor), judged on a ticket lacking everything and on one with everything', () => {
    const lines: string[] = [];
    for (const status of TICKET_STATUSES)
      for (const name of lifecycle.names)
        for (const actor of ['human', 'agent'] as const)
          for (const [fixture, fields] of Object.entries(FIXTURES)) {
            const judged = lifecycle.judge({ ...fields, status }, name, actor);
            // a refusal names its owner only when that owner decides something, as the API's 409 does
            const owner = judged.ok ? undefined : decidingOwner(judged.owner);
            lines.push(`${status} ${name} ${actor} ${fixture}: ${judged.ok ? `-> ${judged.edge.to}` : `409 ${owner ? `${owner} ` : ''}${judged.refusal}`}`);
          }
    expect(lines).toMatchSnapshot();
  });

  test('every (from, to) pair: the arrow a drop takes, or the sentence refusing it', () => {
    const lines = TICKET_STATUSES.flatMap((from) =>
      TICKET_STATUSES.map((to) => {
        const found = lifecycle.toward(from, to);
        return `${from} -> ${to}: ${found.ok ? found.edge.name : found.refusal}`;
      }),
    );
    expect(lines).toMatchSnapshot();
  });
});
