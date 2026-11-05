import { defineHistory, diff, type ActorOf, type Change, type HistoryStore, type KindOf, type SubjectOf } from '@goblin/history';
import { defineLabels, type LabelOf } from '@goblin/labels';
import { defineWorkflow, type NameOf, type StatusOf } from '@goblin/workflow';

export const todo = defineWorkflow({
  noun: 'task',
  statuses: ['todo', 'doing', 'done'],
  actors: { me: ['me'] },
  transitions: {
    start: { from: ['todo'], to: 'doing', owner: 'me' },
    finish: { from: ['doing'], to: 'done', owner: 'me' },
    reopen: { from: ['done'], to: 'todo', owner: 'me' },
  },
});

export const todoLabels = defineLabels({ vocabulary: ['errand', 'work', 'home'] });

export const todoHistory = defineHistory({
  subjects: ['task'],
  kinds: ['created', 'moved', 'retitled', 'labelled'],
  actors: ['me'],
  sessions: { kinds: ['retitled'], windowMs: 60_000 },
});

export type TodoStatus = StatusOf<typeof todo>;
export type TodoMove = NameOf<typeof todo>;
export type TodoLabel = LabelOf<typeof todoLabels>;

type TaskSubject = SubjectOf<typeof todoHistory>;
type TaskKind = KindOf<typeof todoHistory>;
type TaskActor = ActorOf<typeof todoHistory>;
type TaskChange = Change<TaskSubject, TaskKind, TaskActor, number>;

export type TaskEvent = TaskChange & { readonly id: number };

export interface Item {
  readonly id: number;
  readonly title: string;
  readonly status: TodoStatus;
  readonly labels: readonly TodoLabel[];
}

export type Changed = { ok: true; item: Item } | { ok: false; refusal: string };

const sameLabels = (a: readonly TodoLabel[], b: readonly TodoLabel[]) => a.length === b.length && a.every((label, i) => label === b[i]);

export function createTodo({ now = () => new Date().toISOString() } = {}) {
  const tasks = new Map<number, Item>();
  const events: TaskEvent[] = [];
  let lastTask = 0;
  let lastEvent = 0;

  const store: HistoryStore<TaskSubject, TaskKind, TaskActor, number, TaskEvent, () => void> = {
    openSession: async (key, since) =>
      events
        .filter((event) => event.subject_kind === key.subject_kind && event.subject_id === key.subject_id && event.actor === key.actor && event.kind === key.kind && event.at >= since)
        .reduce<TaskEvent | undefined>((newest, event) => (!newest || event.at >= newest.at ? event : newest), undefined),
    append: (change) => () => {
      events.push({ id: ++lastEvent, ...change });
    },
    amend: (open, merged) => () => {
      events[events.indexOf(open)] = { ...open, ...merged };
    },
    list: async (subject_kind, subject_id) => events.filter((event) => event.subject_kind === subject_kind && event.subject_id === subject_id),
  };

  /** The change and its Event land together or not at all (ADR-0014): `expected` is the task the change was decided against, absent for a new one. */
  const commit = async (expected: Item | undefined, next: Item, event: Pick<TaskChange, 'kind' | 'prior' | 'new'>): Promise<Changed> => {
    const write = await todoHistory.record(store, { subject_kind: 'task', subject_id: next.id, actor: 'me', at: now(), ...event });
    if (tasks.get(next.id) !== expected) return { ok: false, refusal: `task ${next.id} changed while this was being recorded` };
    tasks.set(next.id, next);
    write();
    return { ok: true, item: next };
  };

  const noTask = (id: number): Changed => ({ ok: false, refusal: `no task ${id}` });

  return {
    async add(title: string): Promise<Item> {
      const item: Item = { id: ++lastTask, title, status: 'todo', labels: [] };
      await commit(undefined, item, { kind: 'created', prior: null, new: { title, status: item.status, labels: item.labels } });
      return item;
    },

    async move(id: number, name: TodoMove): Promise<Changed> {
      const item = tasks.get(id);
      if (!item) return noTask(id);
      const judged = todo.judge(item, name, 'me');
      if (!judged.ok) return { ok: false, refusal: judged.refusal };
      const { edge } = judged;
      return commit(item, { ...item, status: edge.to }, { kind: 'moved', prior: { status: item.status }, new: { status: edge.to, transition: edge.name } });
    },

    async retitle(id: number, title: string): Promise<Changed> {
      const item = tasks.get(id);
      if (!item) return noTask(id);
      const change = diff(item, { title });
      if (!change.changed) return { ok: true, item };
      return commit(item, { ...item, title }, { kind: 'retitled', prior: change.prior, new: change.new });
    },

    /** Sets the task's whole label set. */
    async label(id: number, names: readonly string[]): Promise<Changed> {
      const item = tasks.get(id);
      if (!item) return noTask(id);
      const judged = todoLabels.judge(names);
      if (!judged.ok) return { ok: false, refusal: judged.refusal };
      if (sameLabels(item.labels, judged.labels)) return { ok: true, item };
      return commit(item, { ...item, labels: judged.labels }, { kind: 'labelled', prior: { labels: item.labels }, new: { labels: judged.labels } });
    },

    history: (id: number): Promise<TaskEvent[]> => todoHistory.read(store, 'task', id),
  };
}
