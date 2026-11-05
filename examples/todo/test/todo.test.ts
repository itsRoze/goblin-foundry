import { describe, expect, test } from 'bun:test';
import { createTodo, todo, todoLabels } from '../src/todo';

const NOON = '2026-01-01T12:00:00.000Z';
const seconds = (n: number) => new Date(Date.parse(NOON) + n * 1000).toISOString();

/** A tracker whose clock stays where the test last set it. */
function atClock() {
  let at = NOON;
  return { tracker: createTodo({ now: () => at }), set: (next: string) => (at = next) };
}

const event = { subject_kind: 'task', subject_id: 1, actor: 'me' } as const;

describe('the todo tracker', () => {
  test('a new task is to do, and starting it is doing it', async () => {
    const { add, move } = createTodo();
    const task = await add('buy milk');
    expect(await move(task.id, 'start')).toEqual({ ok: true, item: { id: 1, title: 'buy milk', status: 'doing', labels: [] } });
  });

  test('a task walks the three statuses and back round', async () => {
    const { add, move } = createTodo();
    const { id } = await add('buy milk');
    await move(id, 'start');
    expect(await move(id, 'finish')).toEqual({ ok: true, item: { id: 1, title: 'buy milk', status: 'done', labels: [] } });
    expect(await move(id, 'reopen')).toEqual({ ok: true, item: { id: 1, title: 'buy milk', status: 'todo', labels: [] } });
  });

  test('a task cannot skip ahead, and the refusal says so in the tracker’s own noun', async () => {
    const { add, move } = createTodo();
    const { id } = await add('buy milk');
    expect(await move(id, 'finish')).toEqual({ ok: false, refusal: 'a task in todo does not go to done' });
    await move(id, 'start');
    await move(id, 'finish');
    expect(await move(id, 'finish')).toEqual({ ok: false, refusal: 'a task in done is already in done' });
    expect(await move(id, 'start')).toEqual({ ok: false, refusal: 'a task in done does not go back to doing' });
  });

  test('the board reads the same table: a card drops from done onto todo, and doing offers only finish', () => {
    expect(todo.toward('done', 'todo')).toEqual({ ok: true, edge: { from: 'done', to: 'todo', name: 'reopen', owner: 'me', direction: 'back', guarded: false } });
    expect(todo.from('doing').map((e) => e.name)).toEqual(['finish']);
  });

  test('a task is labelled from the fixed list, however the label is typed', async () => {
    const { add, label } = createTodo();
    const { id } = await add('buy milk');
    expect(await label(id, ['Errand', 'home', 'errand'])).toEqual({ ok: true, item: { id: 1, title: 'buy milk', status: 'todo', labels: ['errand', 'home'] } });
  });

  test('a label outside the fixed list is refused, and the refusal names the ones it has', async () => {
    const { add, label } = createTodo();
    const { id } = await add('buy milk');
    expect(await label(id, ['errand', 'urgent'])).toEqual({ ok: false, refusal: 'urgent is not a label here; the labels are errand, work and home' });
  });

  test('labels ride along when a task moves', async () => {
    const { add, label, move } = createTodo();
    const { id } = await add('file taxes');
    await label(id, ['home']);
    expect(await move(id, 'start')).toEqual({ ok: true, item: { id: 1, title: 'file taxes', status: 'doing', labels: ['home'] } });
  });

  test('the list filters any-of on its labels', async () => {
    const { add, label } = createTodo();
    const labelled = async (title: string, names: string[]) => label((await add(title)).id, names);
    const tasks = [await labelled('buy milk', ['errand']), await labelled('ship report', ['work']), await labelled('fix tap', ['home', 'errand'])].flatMap((r) => (r.ok ? [r.item] : []));
    expect(tasks.filter((t) => todoLabels.matches(t.labels, ['errand'])).map((t) => t.title)).toEqual(['buy milk', 'fix tap']);
    expect(tasks.filter((t) => todoLabels.matches(t.labels, [])).map((t) => t.title)).toEqual(['buy milk', 'ship report', 'fix tap']);
  });
});

describe('a task\u2019s History', () => {
  test('runs from created across start, finish and reopen, newest first', async () => {
    const { tracker, set } = atClock();
    const { id } = await tracker.add('buy milk');
    set(seconds(1));
    await tracker.move(id, 'start');
    set(seconds(2));
    await tracker.move(id, 'finish');
    set(seconds(3));
    await tracker.move(id, 'reopen');
    expect(await tracker.history(id)).toEqual([
      { ...event, id: 4, kind: 'moved', prior: { status: 'done' }, new: { status: 'todo', transition: 'reopen' }, at: seconds(3) },
      { ...event, id: 3, kind: 'moved', prior: { status: 'doing' }, new: { status: 'done', transition: 'finish' }, at: seconds(2) },
      { ...event, id: 2, kind: 'moved', prior: { status: 'todo' }, new: { status: 'doing', transition: 'start' }, at: seconds(1) },
      { ...event, id: 1, kind: 'created', prior: null, new: { title: 'buy milk', status: 'todo', labels: [] }, at: NOON },
    ]);
  });

  test('a label change records the whole set before and after', async () => {
    const { tracker } = atClock();
    const { id } = await tracker.add('fix tap');
    await tracker.label(id, ['home']);
    await tracker.label(id, ['home', 'Errand']);
    expect((await tracker.history(id)).slice(0, 2)).toEqual([
      { ...event, id: 3, kind: 'labelled', prior: { labels: ['home'] }, new: { labels: ['home', 'errand'] }, at: NOON },
      { ...event, id: 2, kind: 'labelled', prior: { labels: [] }, new: { labels: ['home'] }, at: NOON },
    ]);
  });

  test('a refused move or label records nothing', async () => {
    const { tracker } = atClock();
    const { id } = await tracker.add('buy milk');
    expect(await tracker.move(id, 'finish')).toEqual({ ok: false, refusal: 'a task in todo does not go to done' });
    expect(await tracker.label(id, ['urgent'])).toEqual({ ok: false, refusal: 'urgent is not a label here; the labels are errand, work and home' });
    expect(await tracker.history(id)).toEqual([{ ...event, id: 1, kind: 'created', prior: null, new: { title: 'buy milk', status: 'todo', labels: [] }, at: NOON }]);
  });
});

describe('retitling', () => {
  test('changes the title and records what it was', async () => {
    const { tracker } = atClock();
    const { id } = await tracker.add('buy mlik');
    expect(await tracker.retitle(id, 'buy milk')).toEqual({ ok: true, item: { id: 1, title: 'buy milk', status: 'todo', labels: [] } });
    expect((await tracker.history(id))[0]).toEqual({ ...event, id: 2, kind: 'retitled', prior: { title: 'buy mlik' }, new: { title: 'buy milk' }, at: NOON });
  });

  test('a retitle exactly a minute after the last joins it, keeping the title the sitting started from', async () => {
    const { tracker, set } = atClock();
    const { id } = await tracker.add('buy mlik');
    await tracker.retitle(id, 'buy mil');
    set('2026-01-01T12:01:00.000Z');
    await tracker.retitle(id, 'buy milk');
    expect((await tracker.history(id)).slice(0, -1)).toEqual([{ ...event, id: 2, kind: 'retitled', prior: { title: 'buy mlik' }, new: { title: 'buy milk' }, at: '2026-01-01T12:01:00.000Z' }]);
  });

  test('a retitle a millisecond past the minute is a new Event', async () => {
    const { tracker, set } = atClock();
    const { id } = await tracker.add('buy mlik');
    await tracker.retitle(id, 'buy mil');
    set('2026-01-01T12:01:00.001Z');
    await tracker.retitle(id, 'buy milk');
    expect((await tracker.history(id)).slice(0, -1)).toEqual([
      { ...event, id: 3, kind: 'retitled', prior: { title: 'buy mil' }, new: { title: 'buy milk' }, at: '2026-01-01T12:01:00.001Z' },
      { ...event, id: 2, kind: 'retitled', prior: { title: 'buy mlik' }, new: { title: 'buy mil' }, at: NOON },
    ]);
  });

  test('a retitle of another task in the same minute is that task\u2019s own Event', async () => {
    const { tracker } = atClock();
    const first = await tracker.add('buy mlik');
    const second = await tracker.add('fix tpa');
    await tracker.retitle(first.id, 'buy milk');
    await tracker.retitle(second.id, 'fix tap');
    expect((await tracker.history(first.id))[0]).toEqual({ ...event, id: 3, kind: 'retitled', prior: { title: 'buy mlik' }, new: { title: 'buy milk' }, at: NOON });
    expect((await tracker.history(second.id))[0]).toEqual({ ...event, subject_id: 2, id: 4, kind: 'retitled', prior: { title: 'fix tpa' }, new: { title: 'fix tap' }, at: NOON });
  });

  test('a retitle to the same title answers ok and records nothing', async () => {
    const { tracker } = atClock();
    const { id } = await tracker.add('buy milk');
    expect(await tracker.retitle(id, 'buy milk')).toEqual({ ok: true, item: { id: 1, title: 'buy milk', status: 'todo', labels: [] } });
    expect((await tracker.history(id)).map((e) => e.kind)).toEqual(['created']);
  });
});

describe('labelling with nothing new', () => {
  test('the same names in the same order answer ok and record nothing, while a new order records', async () => {
    const { tracker } = atClock();
    const { id } = await tracker.add('fix tap');
    await tracker.label(id, ['home', 'errand']);
    expect(await tracker.label(id, ['Home', 'errand'])).toEqual({ ok: true, item: { id: 1, title: 'fix tap', status: 'todo', labels: ['home', 'errand'] } });
    expect((await tracker.history(id)).map((e) => e.kind)).toEqual(['labelled', 'created']);
    await tracker.label(id, ['errand', 'home']);
    expect((await tracker.history(id)).map((e) => e.kind)).toEqual(['labelled', 'labelled', 'created']);
  });
});

describe('an id no task has', () => {
  test('is refused by name, and has no History', async () => {
    const { tracker } = atClock();
    const refusal = { ok: false, refusal: 'no task 9' } as const;
    expect(await tracker.move(9, 'start')).toEqual(refusal);
    expect(await tracker.retitle(9, 'buy milk')).toEqual(refusal);
    expect(await tracker.label(9, ['home'])).toEqual(refusal);
    expect(await tracker.history(9)).toEqual([]);
  });
});

describe('two changes that judged the same task', () => {
  test('two concurrent starts land one Event and one refusal', async () => {
    const { tracker } = atClock();
    const { id } = await tracker.add('buy milk');
    expect(await Promise.all([tracker.move(id, 'start'), tracker.move(id, 'start')])).toEqual([
      { ok: true, item: { id: 1, title: 'buy milk', status: 'doing', labels: [] } },
      { ok: false, refusal: 'task 1 changed while this was being recorded' },
    ]);
    expect((await tracker.history(id)).map((e) => e.kind)).toEqual(['moved', 'created']);
  });

  test('two concurrent retitles land the first, so the task and its History agree', async () => {
    const { tracker } = atClock();
    const { id } = await tracker.add('buy mlik');
    expect(await Promise.all([tracker.retitle(id, 'buy milk'), tracker.retitle(id, 'buy oat milk')])).toEqual([
      { ok: true, item: { id: 1, title: 'buy milk', status: 'todo', labels: [] } },
      { ok: false, refusal: 'task 1 changed while this was being recorded' },
    ]);
    expect((await tracker.history(id))[0]).toEqual({ ...event, id: 2, kind: 'retitled', prior: { title: 'buy mlik' }, new: { title: 'buy milk' }, at: NOON });
  });
});
