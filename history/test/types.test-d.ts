import { defineHistory, type ActorOf, type HistoryStore, type KindOf, type Stored, type SubjectOf } from '../src/index';

const tracker = defineHistory({ subjects: ['ticket'], kinds: ['edited', 'moved'], actors: ['human'], sessions: { kinds: ['edited'], windowMs: 1 } });

const subject: SubjectOf<typeof tracker> = 'ticket';
// @ts-expect-error not a declared subject
const notASubject: SubjectOf<typeof tracker> = 'app';
const kind: KindOf<typeof tracker> = 'moved';
// @ts-expect-error not a declared kind
const notAKind: KindOf<typeof tracker> = 'renamed';
const actor: ActorOf<typeof tracker> = 'human';
// @ts-expect-error not a declared actor
const notAnActor: ActorOf<typeof tracker> = 'agent';

const lists: readonly ['edited' | 'moved', ...('edited' | 'moved')[]] = tracker.kinds;

declare const store: HistoryStore<'ticket', 'edited' | 'moved', 'human', number, Stored, () => void>;
const change = { subject_kind: 'ticket', subject_id: 1, actor: 'human', kind: 'edited', prior: null, new: {}, at: '' } as const;

const write: Promise<() => void> = tracker.record(store, change);
const events: Promise<Stored[]> = tracker.read(store, 'ticket', 1);

// @ts-expect-error `record` knows only the declared kinds
tracker.record(store, { ...change, kind: 'renamed' });
// @ts-expect-error `record` knows only the declared subjects
tracker.record(store, { ...change, subject_kind: 'app' });
// @ts-expect-error `record` knows only the declared actors
tracker.record(store, { ...change, actor: 'agent' });
// @ts-expect-error `read` knows only the declared subjects
tracker.read(store, 'app', 1);
// @ts-expect-error `at` is required: the Piece never reads a clock
tracker.record(store, { subject_kind: 'ticket', subject_id: 1, actor: 'human', kind: 'edited', prior: null, new: {} });

defineHistory({
  subjects: ['ticket'],
  kinds: ['edited'],
  actors: ['human'],
  // @ts-expect-error a session rule names only kinds the definition has
  sessions: { kinds: ['moved'], windowMs: 1 },
});
// @ts-expect-error a list names at least one
defineHistory({ subjects: [], kinds: ['edited'], actors: ['human'] });
