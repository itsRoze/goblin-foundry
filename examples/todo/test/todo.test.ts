import { describe, expect, test } from 'bun:test';
import { add, label, move, todo, todoLabels } from '../src/todo';

describe('the todo tracker', () => {
  test('a new task is to do, and starting it is doing it', () => {
    expect(move(add('buy milk'), 'start')).toEqual({ ok: true, item: { title: 'buy milk', status: 'doing', labels: [] } });
  });

  test('a task walks the three statuses and back round', () => {
    const started = move(add('buy milk'), 'start');
    const finished = started.ok ? move(started.item, 'finish') : started;
    expect(finished).toEqual({ ok: true, item: { title: 'buy milk', status: 'done', labels: [] } });
    const reopened = finished.ok ? move(finished.item, 'reopen') : finished;
    expect(reopened).toEqual({ ok: true, item: { title: 'buy milk', status: 'todo', labels: [] } });
  });

  test('a task cannot skip ahead, and the refusal says so in the tracker’s own noun', () => {
    expect(move(add('buy milk'), 'finish')).toEqual({ ok: false, refusal: 'a task in todo does not go to done' });
    expect(move({ title: 'buy milk', status: 'done', labels: [] }, 'finish')).toEqual({ ok: false, refusal: 'a task in done is already in done' });
    expect(move({ title: 'buy milk', status: 'done', labels: [] }, 'start')).toEqual({ ok: false, refusal: 'a task in done does not go back to doing' });
  });

  test('the board reads the same table: a card drops from done onto todo, and doing offers only finish', () => {
    expect(todo.toward('done', 'todo')).toEqual({ ok: true, edge: { from: 'done', to: 'todo', name: 'reopen', owner: 'me', direction: 'back', guarded: false } });
    expect(todo.from('doing').map((e) => e.name)).toEqual(['finish']);
  });

  test('a task is labelled from the fixed list, however the label is typed', () => {
    expect(label(add('buy milk'), ['Errand', 'home', 'errand'])).toEqual({ ok: true, item: { title: 'buy milk', status: 'todo', labels: ['errand', 'home'] } });
  });

  test('a label outside the fixed list is refused, and the refusal names the ones it has', () => {
    expect(label(add('buy milk'), ['errand', 'urgent'])).toEqual({ ok: false, refusal: 'urgent is not a label here; the labels are errand, work and home' });
  });

  test('labels ride along when a task moves', () => {
    const labelled = label(add('file taxes'), ['home']);
    const started = labelled.ok ? move(labelled.item, 'start') : labelled;
    expect(started).toEqual({ ok: true, item: { title: 'file taxes', status: 'doing', labels: ['home'] } });
  });

  test('the list filters any-of on its labels', () => {
    const tasks = [label(add('buy milk'), ['errand']), label(add('ship report'), ['work']), label(add('fix tap'), ['home', 'errand'])].flatMap((r) => (r.ok ? [r.item] : []));
    expect(tasks.filter((t) => todoLabels.matches(t.labels, ['errand'])).map((t) => t.title)).toEqual(['buy milk', 'fix tap']);
    expect(tasks.filter((t) => todoLabels.matches(t.labels, [])).map((t) => t.title)).toEqual(['buy milk', 'ship report', 'fix tap']);
  });
});
