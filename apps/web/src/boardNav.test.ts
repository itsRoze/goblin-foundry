import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navigationOrder, nextFocusedId, prevFocusedId, reconcileFocus, isNavKeyIgnored } from './boardNav.ts';

const columns = [
  { kind: 'backlog' as const, statusIds: ['s1'] },
  { kind: 'ready_for_design' as const, statusIds: ['s2'] },
  { kind: 'designing' as const, statusIds: ['s3'] },
];
const tickets = [
  { id: 't1', statusId: 's1' },
  { id: 't2', statusId: 's2' },
  { id: 't3', statusId: 's1' },
  { id: 't4', statusId: 's2' },
];

test('navigationOrder() flattens tickets in column order, then per-column list order', () => {
  assert.deepEqual(navigationOrder(columns, tickets), ['t1', 't3', 't2', 't4']);
});

test('navigationOrder() skips columns with no tickets and returns [] when there are none', () => {
  assert.deepEqual(navigationOrder(columns, []), []);
});

const order = ['t1', 't3', 't2', 't4'];

test('nextFocusedId() focuses the first card when nothing is focused', () => {
  assert.equal(nextFocusedId(order, null), 't1');
});

test('nextFocusedId() does nothing when there are no cards', () => {
  assert.equal(nextFocusedId([], null), null);
});

test('nextFocusedId() moves to the next card in order', () => {
  assert.equal(nextFocusedId(order, 't3'), 't2');
});

test('nextFocusedId() does nothing when the focused card is last', () => {
  assert.equal(nextFocusedId(order, 't4'), 't4');
});

test('prevFocusedId() does nothing when nothing is focused', () => {
  assert.equal(prevFocusedId(order, null), null);
});

test('prevFocusedId() moves to the previous card in order', () => {
  assert.equal(prevFocusedId(order, 't2'), 't3');
});

test('prevFocusedId() does nothing when the focused card is first', () => {
  assert.equal(prevFocusedId(order, 't1'), 't1');
});

test('reconcileFocus() keeps focus on a ticket that still exists', () => {
  assert.equal(reconcileFocus(order, 't2'), 't2');
});

test('reconcileFocus() clears focus when the ticket no longer exists', () => {
  assert.equal(reconcileFocus(order, 'gone'), null);
});

test('reconcileFocus() leaves an already-clear focus alone', () => {
  assert.equal(reconcileFocus(order, null), null);
});

test('isNavKeyIgnored() ignores keystrokes carrying a modifier', () => {
  assert.equal(isNavKeyIgnored({ metaKey: true, ctrlKey: false, altKey: false, target: null }), true);
  assert.equal(isNavKeyIgnored({ metaKey: false, ctrlKey: true, altKey: false, target: null }), true);
  assert.equal(isNavKeyIgnored({ metaKey: false, ctrlKey: false, altKey: true, target: null }), true);
});

test('isNavKeyIgnored() ignores keystrokes from an input or textarea', () => {
  assert.equal(
    isNavKeyIgnored({ metaKey: false, ctrlKey: false, altKey: false, target: { tagName: 'INPUT' } }),
    true,
  );
  assert.equal(
    isNavKeyIgnored({ metaKey: false, ctrlKey: false, altKey: false, target: { tagName: 'TEXTAREA' } }),
    true,
  );
});

test('isNavKeyIgnored() ignores keystrokes from a contentEditable element', () => {
  assert.equal(
    isNavKeyIgnored({
      metaKey: false, ctrlKey: false, altKey: false,
      target: { tagName: 'DIV', isContentEditable: true },
    }),
    true,
  );
});

test('isNavKeyIgnored() allows a plain keystroke on the board', () => {
  assert.equal(
    isNavKeyIgnored({ metaKey: false, ctrlKey: false, altKey: false, target: { tagName: 'A' } }),
    false,
  );
  assert.equal(isNavKeyIgnored({ metaKey: false, ctrlKey: false, altKey: false, target: null }), false);
});
