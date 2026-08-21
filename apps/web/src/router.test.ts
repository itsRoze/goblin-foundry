import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, href } from './router.ts';

test('parse() reads the board route from an empty or bare hash', () => {
  assert.deepEqual(parse('#/'), { name: 'board' });
  assert.deepEqual(parse(''), { name: 'board' });
});

test('parse() reads a canonical ticket ref', () => {
  assert.deepEqual(parse('#/FAC-10'), { name: 'ticket', key: 'FAC', shortId: 10 });
  assert.deepEqual(parse('#/gf2-3'), { name: 'ticket', key: 'GF2', shortId: 3 });
});

test('parse() reads a legacy bare-number ticket link', () => {
  assert.deepEqual(parse('#/t/10'), { name: 'ticket-legacy', shortId: 10 });
});

test('parse() reads a run link', () => {
  assert.deepEqual(parse('#/r/run_abc123'), { name: 'run', runId: 'run_abc123' });
});

test('parse() reads the bare inbox route with no item expanded', () => {
  assert.deepEqual(parse('#/inbox'), { name: 'inbox', itemId: undefined });
});

test('parse() reads an inbox deep link, keeping the kind-prefixed item id intact', () => {
  assert.deepEqual(parse('#/inbox/round:ph_1'), { name: 'inbox', itemId: 'round:ph_1' });
  assert.deepEqual(parse('#/inbox/approval:d_9'), { name: 'inbox', itemId: 'approval:d_9' });
  assert.deepEqual(parse('#/inbox/stuck:tk_3'), { name: 'inbox', itemId: 'stuck:tk_3' });
});

test('parse() falls back to board for garbage or an unrecognized path', () => {
  assert.deepEqual(parse('#/not-a-ref-or-route'), { name: 'board' });
  assert.deepEqual(parse('#/'), { name: 'board' });
  assert.deepEqual(parse('#/FAC-'), { name: 'board' });
});

test('href.ticket() produces a URL parse() reads back as the same canonical ticket route', () => {
  assert.deepEqual(parse(href.ticket('fac', 10)), { name: 'ticket', key: 'FAC', shortId: 10 });
});

test('href.run() produces a URL parse() reads back as the same run route', () => {
  assert.deepEqual(parse(href.run('run_xyz')), { name: 'run', runId: 'run_xyz' });
});

test('href.inboxItem() produces a URL parse() reads back as the same inbox item', () => {
  assert.deepEqual(parse(href.inboxItem('stuck:tk_3')), { name: 'inbox', itemId: 'stuck:tk_3' });
});
