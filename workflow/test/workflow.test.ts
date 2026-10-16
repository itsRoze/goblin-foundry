import { describe, expect, test } from 'bun:test';
import { WorkflowDefinitionError, defineWorkflow } from '../src/index';

interface Parcel {
  readonly label: string | null;
  readonly weight: number | null;
}

const parcel = defineWorkflow({
  noun: 'parcel',
  statuses: ['packed', 'shipped', 'delivered', 'returned'],
  actors: { clerk: ['clerk', 'courier'], courier: ['courier'] },
  transitions: {
    send: { from: ['packed', 'returned'], to: 'shipped', owner: 'clerk' },
    deliver: { from: ['shipped'], to: 'delivered', owner: 'courier' },
    bounce: { from: ['delivered'], to: 'returned', owner: 'clerk' },
    restock: { from: ['returned'], to: 'packed', owner: 'clerk' },
    recall: { from: ['shipped'], to: 'returned', owner: 'clerk' },
  },
  requires: {
    in: ['shipped', 'delivered'],
    missing: (p: Parcel) => [...(p.label === null ? ['label' as const] : []), ...(p.weight === null ? ['weight' as const] : [])],
    label: (missing) => ({ label: 'a label', weight: 'a weight' })[missing],
  },
});

const bare: Parcel = { label: null, weight: null };
const labelled: Parcel = { label: 'fragile', weight: 2 };

const SEND_FROM_PACKED = { from: 'packed', to: 'shipped', name: 'send', owner: 'clerk', direction: 'forward', guarded: true } as const;

describe('defineWorkflow', () => {
  test('keeps the statuses and names in table order', () => {
    expect(parcel.statuses).toEqual(['packed', 'shipped', 'delivered', 'returned']);
    expect(parcel.names).toEqual(['send', 'deliver', 'bounce', 'restock', 'recall']);
  });

  test('expands each row into one arrow per `from`, with its direction and whether it crosses into the requirement', () => {
    expect(parcel.edges).toEqual([
      SEND_FROM_PACKED,
      { from: 'returned', to: 'shipped', name: 'send', owner: 'clerk', direction: 'back', guarded: true },
      { from: 'shipped', to: 'delivered', name: 'deliver', owner: 'courier', direction: 'forward', guarded: false },
      { from: 'delivered', to: 'returned', name: 'bounce', owner: 'clerk', direction: 'forward', guarded: false },
      { from: 'returned', to: 'packed', name: 'restock', owner: 'clerk', direction: 'back', guarded: false },
      { from: 'shipped', to: 'returned', name: 'recall', owner: 'clerk', direction: 'forward', guarded: false },
    ]);
  });

  test('parses a name off the wire', () => {
    expect(parcel.isName('send')).toBe(true);
    expect(parcel.isName('sent')).toBe(false);
  });

  test('lists the arrows out of a status in table order', () => {
    expect(parcel.from('returned').map((e) => e.name)).toEqual(['send', 'restock']);
    expect(parcel.from('shipped').map((e) => e.name)).toEqual(['deliver', 'recall']);
  });

  test('throws at load for a status listed twice', () => {
    expect(() => defineWorkflow({ noun: 'x', statuses: ['a', 'b', 'a'], actors: { me: ['me'] }, transitions: { go: { from: ['a'], to: 'b', owner: 'me' } } })).toThrow(
      new WorkflowDefinitionError('status a is listed twice'),
    );
  });

  test('throws at load for a row leading out of one status twice', () => {
    expect(() => defineWorkflow({ noun: 'x', statuses: ['a', 'b'], actors: { me: ['me'] }, transitions: { go: { from: ['a', 'a'], to: 'b', owner: 'me' } } })).toThrow(
      new WorkflowDefinitionError('go leads out of a twice'),
    );
  });

  test('throws at load for two arrows between one pair of statuses', () => {
    expect(() =>
      defineWorkflow({
        noun: 'x',
        statuses: ['a', 'b'],
        actors: { me: ['me'] },
        transitions: { go: { from: ['a'], to: 'b', owner: 'me' }, hop: { from: ['a'], to: 'b', owner: 'me' } },
      }),
    ).toThrow(new WorkflowDefinitionError('a → b is both go and hop'));
  });

  test('throws at load for no transitions', () => {
    expect(() => defineWorkflow({ noun: 'x', statuses: ['a'], actors: { me: ['me'] }, transitions: {} })).toThrow(new WorkflowDefinitionError('no transitions'));
  });

  test('names every fault in one throw', () => {
    let thrown: unknown;
    try {
      defineWorkflow({
        noun: 'x',
        statuses: ['a', 'b', 'b'],
        actors: { me: ['me'] },
        transitions: { go: { from: ['a', 'a'], to: 'b', owner: 'me' }, hop: { from: ['a'], to: 'b', owner: 'me' } },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WorkflowDefinitionError);
    expect((thrown as Error).message).toBe('status b is listed twice; go leads out of a twice; a → b is both go and hop');
  });
});

describe('addressing an arrow', () => {
  test('by (from, name): the arrow, or the sentence about where that name would have gone', () => {
    expect(parcel.named('packed', 'send')).toEqual({ ok: true, edge: SEND_FROM_PACKED });
    expect(parcel.named('packed', 'deliver')).toEqual({ ok: false, refusal: 'a parcel in packed does not go to delivered' });
    expect(parcel.named('delivered', 'send')).toEqual({ ok: false, refusal: 'a parcel in delivered does not go back to shipped' });
    expect(parcel.named('shipped', 'send')).toEqual({ ok: false, refusal: 'a parcel in shipped is already in shipped' });
  });

  test('by (from, to): the arrow, or the sentence about the pair', () => {
    expect(parcel.toward('packed', 'shipped')).toEqual({ ok: true, edge: SEND_FROM_PACKED });
    expect(parcel.toward('packed', 'returned')).toEqual({ ok: false, refusal: 'a parcel in packed does not go to returned' });
    expect(parcel.toward('delivered', 'packed')).toEqual({ ok: false, refusal: 'a parcel in delivered does not go back to packed' });
    expect(parcel.toward('returned', 'returned')).toEqual({ ok: false, refusal: 'a parcel in returned is already in returned' });
  });
});

describe('judging a move', () => {
  test('takes the arrow when it exists, the actor owns it and the subject has what it needs', () => {
    expect(parcel.judge({ ...labelled, status: 'packed' }, 'send', 'clerk')).toEqual({ ok: true, edge: SEND_FROM_PACKED });
  });

  test('refuses structure first, with no owner, whoever asks', () => {
    expect(parcel.judge({ ...bare, status: 'packed' }, 'deliver', 'courier')).toStrictEqual({ ok: false, refusal: 'a parcel in packed does not go to delivered' });
  });

  test('refuses authority before the requirement: an actor who owns no arrow here is not told what is missing', () => {
    expect(parcel.judge({ ...bare, status: 'packed' }, 'send', 'courier')).toEqual({ ok: false, refusal: "send is the clerk's move, not the courier's", owner: 'clerk' });
  });

  test('an actor holds every authority listed under it', () => {
    expect(parcel.judge({ ...labelled, status: 'shipped' }, 'deliver', 'clerk').ok).toBe(true);
    expect(parcel.judge({ ...labelled, status: 'delivered' }, 'bounce', 'courier')).toEqual({ ok: false, refusal: "bounce is the clerk's move, not the courier's", owner: 'clerk' });
  });

  test('refuses the requirement last, naming each missing thing in order, and whose arrow it was', () => {
    expect(parcel.judge({ ...bare, status: 'packed' }, 'send', 'clerk')).toEqual({ ok: false, refusal: 'send needs a label and a weight', owner: 'clerk' });
    expect(parcel.judge({ label: 'fragile', weight: null, status: 'returned' }, 'send', 'clerk')).toEqual({ ok: false, refusal: 'send needs a weight', owner: 'clerk' });
  });

  test('asks the requirement only on an arrow crossing into its statuses, not inside them or out of them', () => {
    expect(parcel.judge({ ...bare, status: 'shipped' }, 'deliver', 'courier').ok).toBe(true);
    expect(parcel.judge({ ...bare, status: 'delivered' }, 'bounce', 'clerk').ok).toBe(true);
    expect(parcel.edges.filter((e) => e.guarded).map((e) => `${e.from} ${e.name}`)).toEqual(['packed send', 'returned send']);
  });
});

describe('missingAt', () => {
  test('is what the requirement finds missing inside its statuses, and nothing outside them', () => {
    expect(parcel.missingAt('shipped', bare)).toEqual(['label', 'weight']);
    expect(parcel.missingAt('delivered', { label: 'fragile', weight: null })).toEqual(['weight']);
    expect(parcel.missingAt('packed', bare)).toEqual([]);
  });

  test('a workflow with no requirement guards nothing and misses nothing', () => {
    const light = defineWorkflow({ noun: 'note', statuses: ['open', 'closed'], actors: { me: ['me'] }, transitions: { close: { from: ['open'], to: 'closed', owner: 'me' } } });
    expect(light.edges.map((e) => e.guarded)).toEqual([false]);
    expect(light.missingAt('closed', {})).toEqual([]);
    expect(light.judge({ status: 'open' }, 'close', 'me')).toEqual({ ok: true, edge: { from: 'open', to: 'closed', name: 'close', owner: 'me', direction: 'forward', guarded: false } });
  });
});
