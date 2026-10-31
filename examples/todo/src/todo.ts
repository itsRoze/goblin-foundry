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

export type TodoStatus = StatusOf<typeof todo>;
export type TodoMove = NameOf<typeof todo>;
export type TodoLabel = LabelOf<typeof todoLabels>;

export interface Item {
  readonly title: string;
  readonly status: TodoStatus;
  readonly labels: readonly TodoLabel[];
}

export type Changed = { ok: true; item: Item } | { ok: false; refusal: string };

export const add = (title: string): Item => ({ title, status: 'todo', labels: [] });

export function move(item: Item, name: TodoMove): Changed {
  const judged = todo.judge(item, name, 'me');
  return judged.ok ? { ok: true, item: { ...item, status: judged.edge.to } } : { ok: false, refusal: judged.refusal };
}

/** Sets the task's whole label set. */
export function label(item: Item, names: readonly string[]): Changed {
  const judged = todoLabels.judge(names);
  return judged.ok ? { ok: true, item: { ...item, labels: judged.labels } } : { ok: false, refusal: judged.refusal };
}
