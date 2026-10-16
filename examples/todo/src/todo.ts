import { defineWorkflow, type NameOf, type StatusOf } from '@goblin/workflow';

/**
 * The second Assembly (ADR-0011): a personal todo list with three statuses,
 * one actor, no Apps or Projects and no guard. Small on purpose, so that
 * anything the Piece makes it say that it has no use for is a smell.
 */
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

export type TodoStatus = StatusOf<typeof todo>;
export type TodoMove = NameOf<typeof todo>;

export interface Item {
  readonly title: string;
  readonly status: TodoStatus;
}

export const add = (title: string): Item => ({ title, status: 'todo' });

/** The whole of the todo tracker's write path: the moved item, or the sentence why not. */
export function move(item: Item, name: TodoMove): { ok: true; item: Item } | { ok: false; refusal: string } {
  const judged = todo.judge(item, name, 'me');
  return judged.ok ? { ok: true, item: { ...item, status: judged.edge.to } } : { ok: false, refusal: judged.refusal };
}
