import { describe, expect, test } from 'bun:test';
import { HistoryDefinitionError, defineHistory, diff, type ActorOf, type Change, type HistoryStore, type KindOf, type SubjectOf } from '../src/index';

const lists = { subjects: ['ticket'], kinds: ['edited'], actors: ['human'] } as const;

const tracker = defineHistory({
  subjects: ['ticket', 'app'],
  kinds: ['edited', 'retitled', 'moved'],
  actors: ['human', 'agent'],
  sessions: { kinds: ['edited', 'retitled'], windowMs: 60_000 },
});

type Subject = SubjectOf<typeof tracker>;
type Kind = KindOf<typeof tracker>;
type Actor = ActorOf<typeof tracker>;
type TrackerChange = Change<Subject, Kind, Actor, number>;
type Row = TrackerChange & { readonly id: number };
type Store = HistoryStore<Subject, Kind, Actor, number, Row, () => void>;

function memoryStore(rows: Row[] = [], listed: (rows: Row[]) => readonly Row[] = (all) => all): Store {
  return {
    openSession: async (key, since) =>
      rows
        .filter((row) => row.subject_kind === key.subject_kind && row.subject_id === key.subject_id && row.actor === key.actor && row.kind === key.kind && row.at >= since)
        .reduce<Row | undefined>((newest, row) => (!newest || row.at >= newest.at ? row : newest), undefined),
    append: (change) => () => rows.push({ id: rows.length + 1, ...change }),
    amend: (open, merged) => () => rows.splice(rows.indexOf(open), 1, { ...open, ...merged }),
    list: async (subject_kind, subject_id) => listed(rows.filter((row) => row.subject_kind === subject_kind && row.subject_id === subject_id)),
  };
}

const NOON = '2026-01-01T12:00:00.000Z';
const edit: TrackerChange = { subject_kind: 'ticket', subject_id: 1, actor: 'human', kind: 'edited', prior: { title: 'a' }, new: { title: 'b' }, at: NOON };
const row = (id: number, change: TrackerChange): Row => ({ id, ...change });

async function save(store: Store, ...changes: Partial<TrackerChange>[]) {
  for (const change of changes) (await tracker.record(store, { ...edit, ...change }))();
}

describe('defineHistory', () => {
  test('throws at load for a list that names nothing, which no type can stop when the list is built at run time', () => {
    const none = [] as unknown as [string];
    expect(() => defineHistory({ subjects: none, kinds: none, actors: none })).toThrow(new HistoryDefinitionError('no subjects; no kinds; no actors'));
  });

  test('throws at load for a blank name or one listed twice, in any list', () => {
    expect(() => defineHistory({ subjects: [' ', 'ticket'], kinds: ['edited', 'edited'], actors: ['human', ''] })).toThrow(
      new HistoryDefinitionError('a subject cannot be blank; kind edited is listed twice; an actor cannot be blank'),
    );
  });

  test('throws at load for a session rule naming no kinds, one twice, or one the definition does not have', () => {
    const none = [] as unknown as ['edited'];
    expect(() => defineHistory({ ...lists, sessions: { kinds: none, windowMs: 1 } })).toThrow(new HistoryDefinitionError('sessions name no kinds'));
    expect(() => defineHistory({ ...lists, sessions: { kinds: ['edited', 'edited', 'moved' as 'edited'], windowMs: 1 } })).toThrow(
      new HistoryDefinitionError('sessions name edited twice; sessions name moved, which is not a kind'),
    );
  });

  test('throws at load for a window that is not a positive finite number', () => {
    for (const windowMs of [0, -1, Infinity, NaN]) {
      expect(() => defineHistory({ ...lists, sessions: { kinds: ['edited'], windowMs } })).toThrow(new HistoryDefinitionError(`a window of ${windowMs}ms is not a positive finite number`));
    }
  });
});

describe('record', () => {
  test('hands back the store\u2019s write unrun, and the Event exists once the Assembly runs it', async () => {
    const store = memoryStore();
    const write = await tracker.record(store, edit);
    expect(await tracker.read(store, 'ticket', 1)).toEqual([]);
    write();
    expect(await tracker.read(store, 'ticket', 1)).toEqual([row(1, edit)]);
  });

  test('a further change by the same Actor to the same subject within the window joins the open Event', async () => {
    const store = memoryStore();
    await save(store, {}, { prior: { title: 'b' }, new: { title: 'c' }, at: '2026-01-01T12:00:30.000Z' });
    expect(await tracker.read(store, 'ticket', 1)).toEqual([row(1, { ...edit, new: { title: 'c' }, at: '2026-01-01T12:00:30.000Z' })]);
  });

  test('the window\u2019s edge joins, and a millisecond past it starts a new Event', async () => {
    const atTheEdge = memoryStore();
    await save(atTheEdge, {}, { new: { title: 'c' }, at: '2026-01-01T12:01:00.000Z' });
    expect(await tracker.read(atTheEdge, 'ticket', 1)).toEqual([row(1, { ...edit, new: { title: 'c' }, at: '2026-01-01T12:01:00.000Z' })]);

    const pastTheEdge = memoryStore();
    await save(pastTheEdge, {}, { new: { title: 'c' }, at: '2026-01-01T12:01:00.001Z' });
    expect(await tracker.read(pastTheEdge, 'ticket', 1)).toEqual([row(2, { ...edit, new: { title: 'c' }, at: '2026-01-01T12:01:00.001Z' }), row(1, edit)]);
  });

  test('the window runs from the session\u2019s last change, not its first', async () => {
    const store = memoryStore();
    await save(store, {}, { new: { title: 'c' }, at: '2026-01-01T12:00:50.000Z' }, { new: { title: 'd' }, at: '2026-01-01T12:01:40.000Z' });
    expect(await tracker.read(store, 'ticket', 1)).toEqual([row(1, { ...edit, new: { title: 'd' }, at: '2026-01-01T12:01:40.000Z' })]);
  });

  test('another subject kind starts its own Event', async () => {
    const store = memoryStore();
    await save(store, {}, { subject_kind: 'app' });
    expect(await tracker.read(store, 'ticket', 1)).toEqual([row(1, edit)]);
    expect(await tracker.read(store, 'app', 1)).toEqual([row(2, { ...edit, subject_kind: 'app' })]);
  });

  test('another subject id starts its own Event', async () => {
    const store = memoryStore();
    await save(store, {}, { subject_id: 2 });
    expect(await tracker.read(store, 'ticket', 1)).toEqual([row(1, edit)]);
    expect(await tracker.read(store, 'ticket', 2)).toEqual([row(2, { ...edit, subject_id: 2 })]);
  });

  test('another Actor starts their own Event', async () => {
    const store = memoryStore();
    await save(store, {}, { actor: 'agent' });
    expect(await tracker.read(store, 'ticket', 1)).toEqual([row(2, { ...edit, actor: 'agent' }), row(1, edit)]);
  });

  test('another joining kind starts its own Event', async () => {
    const store = memoryStore();
    await save(store, {}, { kind: 'retitled' });
    expect(await tracker.read(store, 'ticket', 1)).toEqual([row(2, { ...edit, kind: 'retitled' }), row(1, edit)]);
  });

  test('a kind the session rule does not name always appends', async () => {
    const move: Partial<TrackerChange> = { kind: 'moved', prior: { status: 'todo' }, new: { status: 'doing' } };
    const store = memoryStore();
    await save(store, move, { ...move, prior: { status: 'doing' }, new: { status: 'done' } });
    expect(await tracker.read(store, 'ticket', 1)).toEqual([row(2, { ...edit, ...move, prior: { status: 'doing' }, new: { status: 'done' } }), row(1, { ...edit, ...move })]);
  });

  test('a joined Event keeps what the sitting started from for each field, however late it was first touched, while `new` and `at` advance', async () => {
    const store = memoryStore();
    await save(
      store,
      { prior: { title: 'a' }, new: { title: 'b' } },
      { prior: { title: 'b', body: 'x' }, new: { title: 'c', body: 'y' }, at: '2026-01-01T12:00:10.000Z' },
      { prior: { body: 'y', due: null }, new: { body: 'z', due: 'friday' }, at: '2026-01-01T12:00:20.000Z' },
    );
    expect(await tracker.read(store, 'ticket', 1)).toEqual([row(1, { ...edit, prior: { title: 'a', body: 'x', due: null }, new: { title: 'c', body: 'z', due: 'friday' }, at: '2026-01-01T12:00:20.000Z' })]);
  });

  test('a field an earlier save changed stays in `new` when a later save does not touch it', async () => {
    const store = memoryStore();
    await save(store, { prior: { title: 'a' }, new: { title: 'b' } }, { prior: { body: 'x' }, new: { body: 'y' } });
    expect(await tracker.read(store, 'ticket', 1)).toEqual([row(1, { ...edit, prior: { title: 'a', body: 'x' }, new: { title: 'b', body: 'y' } })]);
  });

  test('a session interrupted by another kind of Event still joins', async () => {
    const store = memoryStore();
    await save(store, {}, { kind: 'moved', prior: { status: 'todo' }, new: { status: 'doing' } }, { new: { title: 'c' }, at: '2026-01-01T12:00:30.000Z' });
    expect(await tracker.read(store, 'ticket', 1)).toEqual([
      row(1, { ...edit, new: { title: 'c' }, at: '2026-01-01T12:00:30.000Z' }),
      row(2, { ...edit, kind: 'moved', prior: { status: 'todo' }, new: { status: 'doing' } }),
    ]);
  });

  test('a session interrupted by another Actor still joins', async () => {
    const store = memoryStore();
    await save(store, {}, { actor: 'agent', at: '2026-01-01T12:00:10.000Z' }, { new: { title: 'c' }, at: '2026-01-01T12:00:20.000Z' });
    expect(await tracker.read(store, 'ticket', 1)).toEqual([
      row(1, { ...edit, new: { title: 'c' }, at: '2026-01-01T12:00:20.000Z' }),
      row(2, { ...edit, actor: 'agent', at: '2026-01-01T12:00:10.000Z' }),
    ]);
  });

  test('with no session rule, every change appends', async () => {
    const plain = defineHistory({ subjects: ['ticket', 'app'], kinds: ['edited', 'retitled', 'moved'], actors: ['human', 'agent'] });
    const store = memoryStore();
    (await plain.record(store, edit))();
    (await plain.record(store, { ...edit, new: { title: 'c' } }))();
    expect(await plain.read(store, 'ticket', 1)).toEqual([row(2, { ...edit, new: { title: 'c' } }), row(1, edit)]);
  });
});

describe('read', () => {
  test('sorts whatever order the store returns, newest `at` first and the highest id on a tie, without touching the store\u2019s array', async () => {
    const at = (id: number, at: string) => row(id, { ...edit, at });
    const rows = [at(1, '2026-01-01T12:00:00.000Z'), at(2, '2026-01-01T12:00:02.000Z'), at(3, '2026-01-01T12:00:02.000Z'), at(4, '2026-01-01T12:00:01.000Z')];
    const shuffled = memoryStore(rows, () => Object.freeze([rows[3]!, rows[1]!, rows[0]!, rows[2]!]));
    expect((await tracker.read(shuffled, 'ticket', 1)).map((event) => event.id)).toEqual([3, 2, 4, 1]);
  });
});

describe('diff', () => {
  test('holds only the fields that differ', () => {
    expect(diff({ title: 'a', body: 'x' }, { title: 'b', body: 'x' })).toEqual({ prior: { title: 'a' }, new: { title: 'b' }, changed: true });
  });

  test('says when nothing changed', () => {
    expect(diff({ title: 'a' }, { title: 'a' })).toEqual({ prior: {}, new: {}, changed: false });
  });

  test('skips a field left undefined, and a field that had no value reads as null in `prior`', () => {
    expect(diff<{ title: string; due?: string }>({ title: 'a' }, { title: undefined, due: 'friday' })).toEqual({ prior: { due: null }, new: { due: 'friday' }, changed: true });
  });

  test('can clear a field to null', () => {
    expect(diff<{ due: string | null }>({ due: 'friday' }, { due: null })).toEqual({ prior: { due: 'friday' }, new: { due: null }, changed: true });
  });
});
