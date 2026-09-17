import { describe, expect, test } from 'bun:test';
import { bulkLabel, commonMoves, eligibilitySignature, preflight, questionFor, setSignature, type Member } from '../src/bulk';

const member = (id: number, over: Partial<Member> = {}): Member => ({ id, key: `GF-${id}`, status: 'todo', app_id: 1, simple: false, design: 'the plan', blocked_by: [], ...over });

describe('commonMoves', () => {
  test('todo and planning share approve; a shared destination does not make a shared verb', () => {
    expect(commonMoves([member(1), member(2, { status: 'planning' })])).toContain('approve');
    // `approve` (todo → ready) and `stop` (building → ready) land in the same place and are not the same intent
    const mixed = commonMoves([member(1), member(2, { status: 'building' })]);
    expect(mixed).not.toContain('approve');
    expect(mixed).not.toContain('stop');
    expect(mixed).toEqual(['close', 'cancel']);
  });

  test('nothing selected shares nothing', () => expect(commonMoves([])).toEqual([]));
});

describe('preflight', () => {
  test('names every member the table or the guard would refuse, in the API’s own words', () => {
    const refusals = preflight({ kind: 'transition', name: 'approve' }, [member(1), member(2, { status: 'ready' }), member(3, { design: null }), member(4, { app_id: null, simple: true })]);
    expect(refusals).toEqual([
      { key: 'GF-2', reason: 'a ticket in ready is already in ready' },
      { key: 'GF-3', reason: 'approve needs a ticket design' },
      { key: 'GF-4', reason: 'approve needs an app' },
    ]);
  });

  test('a move or a trash is the API’s to judge', () => {
    expect(preflight({ kind: 'trash' }, [member(1, { status: 'done' })])).toEqual([]);
    expect(preflight({ kind: 'move', to: { kind: 'nowhere' } }, [member(1, { status: 'ready' })])).toEqual([]);
  });
});

describe('questionFor', () => {
  test('trash asks once with the whole count', () => {
    expect(questionFor({ kind: 'trash' }, [member(1), member(2), member(3)])).toEqual({
      text: 'Trash 3 Tickets?',
      // named, because some may be folded or a screen away — and told the trash is the undo
      lines: ['GF-1 GF-2 GF-3', 'each can be restored from the trash'],
      verb: 'trash',
      danger: true,
    });
    expect(questionFor({ kind: 'trash' }, [member(1)])?.text).toBe('Trash 1 Ticket?');
    // a whole board is counted, not recited
    const many = Array.from({ length: 15 }, (_, i) => member(i + 1));
    expect(questionFor({ kind: 'trash' }, many)?.lines[0]).toBe('GF-1 GF-2 GF-3 GF-4 GF-5 GF-6 GF-7 GF-8 GF-9 GF-10 GF-11 GF-12 and 3 more');
  });

  test('start asks only when a member is blocked, and lists each with its blockers', () => {
    const start = { kind: 'transition', name: 'start' } as const;
    expect(questionFor(start, [member(1, { status: 'ready' })])).toBeNull();
    const asked = questionFor(start, [member(1, { status: 'ready' }), member(2, { status: 'ready', blocked_by: ['GF-7', 'GF-8'] })]);
    expect(asked?.text).toBe('1 Ticket of 2 still has open blockers');
    expect(asked?.lines).toEqual(['GF-2 is blocked by GF-7, GF-8']);
    // a go-ahead, not an ending: only trash wears the red
    expect(asked?.danger).toBe(false);
  });

  test('no other verb asks, blocked or not', () => {
    expect(questionFor({ kind: 'transition', name: 'approve' }, [member(1, { blocked_by: ['GF-7'] })])).toBeNull();
  });
});

describe('what a confirmation is bound to', () => {
  test('a retitled ticket changes nothing; a status, a blocker or a different set does', () => {
    const before = [member(1), member(2)];
    expect(eligibilitySignature([member(1), member(2)])).toBe(eligibilitySignature(before));
    expect(eligibilitySignature([member(1), member(2, { blocked_by: ['GF-9'] })])).not.toBe(eligibilitySignature(before));
    expect(eligibilitySignature([member(1), member(2, { status: 'planning' })])).not.toBe(eligibilitySignature(before));
    expect(setSignature([member(1)])).not.toBe(setSignature(before));
    expect(setSignature([member(1, { status: 'done' }), member(2)])).toBe(setSignature(before));
  });
});

describe('bulkLabel', () => {
  test('an action and a count, in the tense of the moment', () => {
    expect(bulkLabel({ kind: 'transition', name: 'approve' }, 10, 'pending')).toBe('Approving 10 Tickets…');
    expect(bulkLabel({ kind: 'transition', name: 'approve' }, 1, 'done')).toBe('Approved 1 Ticket');
    expect(bulkLabel({ kind: 'move', to: { kind: 'nowhere' } }, 3, 'pending')).toBe('Moving 3 Tickets…');
    expect(bulkLabel({ kind: 'trash' }, 2, 'done')).toBe('Trashed 2 Tickets');
  });
});
