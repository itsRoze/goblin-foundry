export type Fields = Readonly<Record<string, unknown>>;

export interface Sessions<K extends string> {
  /** Kinds whose changes join an open session. Every other kind appends. */
  readonly kinds: readonly [NoInfer<K>, ...NoInfer<K>[]];
  /** How long a session stays open after its last change. A change exactly this long after it still joins. */
  readonly windowMs: number;
}

export interface HistoryDefinition<S extends string, K extends string, A extends string> {
  readonly subjects: readonly [S, ...S[]];
  readonly kinds: readonly [K, ...K[]];
  readonly actors: readonly [A, ...A[]];
  /** Absent means every change appends. */
  readonly sessions?: Sessions<K>;
}

export class HistoryDefinitionError extends Error {}

/** What says which sitting a change belongs to: one subject, one Actor, one kind. Other activity in between does not end a session. */
export interface EventKey<S extends string, K extends string, A extends string, Id> {
  readonly subject_kind: S;
  readonly subject_id: Id;
  readonly actor: A;
  readonly kind: K;
}

/** `prior` and `new` hold only the fields that changed; `prior` is null on a `created` Event. */
export interface Change<S extends string, K extends string, A extends string, Id> extends EventKey<S, K, A, Id> {
  readonly prior: Fields | null;
  readonly new: Fields;
  readonly at: string;
}

/** The least the Piece reads off a stored Event. An Assembly's Event type may name its other columns as it likes. */
export interface Stored {
  readonly id: number;
  readonly prior: Fields | null;
  readonly new: Fields;
  readonly at: string;
}

/**
 * What an Assembly implements over its own storage (ADR-0014).
 *
 * `append` and `amend` build a write and do not run it. It stays unrun until the
 * Assembly commits it together with the change it records, so whether the two
 * land together is the Assembly's guarantee, not the Piece's.
 *
 * A write type must not be a thenable: `record` returns it from an async
 * function, and the promise machinery would run it. Wrap a query builder, as
 * `AtomicWrite` does in Goblin Foundry's `api/src/db.ts`.
 */
export interface HistoryStore<S extends string, K extends string, A extends string, Id, E extends Stored, W> {
  /** The newest Event with this key whose `at` is `since` or later. */
  openSession(key: EventKey<S, K, A, Id>, since: string): Promise<E | undefined>;
  append(change: Change<S, K, A, Id>): W;
  amend(open: E, merged: { readonly prior: Fields; readonly new: Fields; readonly at: string }): W;
  /** A subject's Events in any order: `read` sorts them. */
  list(subject_kind: S, subject_id: Id): Promise<readonly E[]>;
}

/**
 * Members are closures over the definition, so `history.record` can be passed
 * as a callback.
 */
export interface History<S extends string, K extends string, A extends string> {
  /** A tuple, as `kinds` and `actors` are, so `z.enum(history.subjects)` works. */
  readonly subjects: readonly [S, ...S[]];
  readonly kinds: readonly [K, ...K[]];
  readonly actors: readonly [A, ...A[]];
  readonly sessions: Sessions<K> | undefined;
  record<Id, E extends Stored, W>(store: HistoryStore<S, K, A, Id, E, W>, change: Change<S, K, A, Id>): Promise<W>;
  read<Id, E extends Stored, W>(store: HistoryStore<S, K, A, Id, E, W>, subject_kind: S, subject_id: Id): Promise<E[]>;
}

export type SubjectOf<H extends { readonly subjects: readonly string[] }> = H['subjects'][number];
export type KindOf<H extends { readonly kinds: readonly string[] }> = H['kinds'][number];
export type ActorOf<H extends { readonly actors: readonly string[] }> = H['actors'][number];

/**
 * Builds the History once, at module load. Throws on a definition the types
 * cannot reject, so a bad Assembly fails its first test rather than a request:
 *
 * - a list that names nothing, or a blank or repeated name in one;
 * - a session rule naming no kinds, one twice, or one outside `kinds`;
 * - a window that is not a positive finite number.
 */
export function defineHistory<const S extends string, const K extends string, const A extends string>(definition: HistoryDefinition<S, K, A>): History<S, K, A> {
  const { subjects, kinds, actors, sessions } = definition;

  const faults: string[] = [];
  const lists: [noun: string, article: string, names: readonly string[]][] = [
    ['subject', 'a', subjects],
    ['kind', 'a', kinds],
    ['actor', 'an', actors],
  ];
  for (const [noun, article, names] of lists) {
    if (names.length === 0) faults.push(`no ${noun}s`);
    for (const [i, name] of names.entries()) {
      if (name.trim() === '') faults.push(`${article} ${noun} cannot be blank`);
      else if (names.indexOf(name) !== i) faults.push(`${noun} ${name} is listed twice`);
    }
  }
  if (sessions) {
    const names: readonly string[] = sessions.kinds;
    if (names.length === 0) faults.push('sessions name no kinds');
    for (const [i, name] of names.entries()) {
      if (names.indexOf(name) !== i) faults.push(`sessions name ${name} twice`);
      else if (!(kinds as readonly string[]).includes(name)) faults.push(`sessions name ${name}, which is not a kind`);
    }
    if (!(Number.isFinite(sessions.windowMs) && sessions.windowMs > 0)) faults.push(`a window of ${sessions.windowMs}ms is not a positive finite number`);
  }
  if (faults.length > 0) throw new HistoryDefinitionError(faults.join('; '));

  const joining = new Set<K>(sessions?.kinds);

  const record = async <Id, E extends Stored, W>(store: HistoryStore<S, K, A, Id, E, W>, change: Change<S, K, A, Id>): Promise<W> => {
    if (!sessions || !joining.has(change.kind)) return store.append(change);
    const since = new Date(new Date(change.at).getTime() - sessions.windowMs).toISOString();
    const open = await store.openSession(change, since);
    if (!open) return store.append(change);
    return store.amend(open, { prior: { ...change.prior, ...open.prior }, new: { ...open.new, ...change.new }, at: change.at });
  };

  // by `at`, not id: a joined Event's row is older than its last change. `<` compares as SQLite orders text, which `localeCompare` would not.
  const read = async <Id, E extends Stored, W>(store: HistoryStore<S, K, A, Id, E, W>, subject_kind: S, subject_id: Id): Promise<E[]> =>
    [...(await store.list(subject_kind, subject_id))].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id));

  return { subjects, kinds, actors, sessions, record, read };
}

/** The subset of `next` whose values differ from `current`, as `{prior, new}`; empty when nothing changed. */
export function diff<T extends object>(current: T, next: Partial<T>) {
  const prior: Record<string, unknown> = {};
  const changed: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof T & string)[]) {
    const value = next[key];
    if (value === undefined || value === current[key]) continue;
    prior[key] = current[key] ?? null;
    changed[key] = value;
  }
  return { prior, new: changed, changed: Object.keys(changed).length > 0 };
}
