import { describe, expect, test } from 'bun:test';
import { add, move, todo } from '../src/todo';

describe('the todo tracker', () => {
  test('a new task is to do, and starting it is doing it', () => {
    expect(move(add('buy milk'), 'start')).toEqual({ ok: true, item: { title: 'buy milk', status: 'doing' } });
  });

  test('a task walks the three statuses and back round', () => {
    const started = move(add('buy milk'), 'start');
    const finished = started.ok ? move(started.item, 'finish') : started;
    expect(finished).toEqual({ ok: true, item: { title: 'buy milk', status: 'done' } });
    const reopened = finished.ok ? move(finished.item, 'reopen') : finished;
    expect(reopened).toEqual({ ok: true, item: { title: 'buy milk', status: 'todo' } });
  });

  test('a task cannot skip ahead, and the refusal says so in the tracker’s own noun', () => {
    expect(move(add('buy milk'), 'finish')).toEqual({ ok: false, refusal: 'a task in todo does not go to done' });
    expect(move({ title: 'buy milk', status: 'done' }, 'finish')).toEqual({ ok: false, refusal: 'a task in done is already in done' });
    expect(move({ title: 'buy milk', status: 'done' }, 'start')).toEqual({ ok: false, refusal: 'a task in done does not go back to doing' });
  });

  test('the board reads the same table: a card drops from done onto todo, and doing offers only finish', () => {
    expect(todo.toward('done', 'todo')).toEqual({ ok: true, edge: { from: 'done', to: 'todo', name: 'reopen', owner: 'me', direction: 'back', guarded: false } });
    expect(todo.from('doing').map((e) => e.name)).toEqual(['finish']);
  });
});
