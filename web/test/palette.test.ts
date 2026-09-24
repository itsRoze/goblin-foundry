import { describe, expect, test } from 'bun:test';
import { PALETTE_ROWS, paletteHits, selectionPlaceRows, selectionRows, transitionRows, type Candidate } from '../src/palette';

/**
 * What `⌘K` offers, as a pure question about a list of candidates: which rows
 * survive a query, in what order, and how many of them there are. The view
 * builds the candidates and performs the actions; the ranking is here, because
 * "the ticket you typed the key of, first" is the whole of what makes the
 * palette usable and none of it needs a browser.
 */

const ticket = (key: string, title: string, inert = false): Candidate => ({
  id: key,
  group: 'tickets',
  label: title,
  key,
  inert,
  action: { kind: 'go', to: `/tickets/${key}` },
});
const go = (label: string): Candidate => ({ id: `go-${label}`, group: 'go to', label, action: { kind: 'go', to: `/${label}` } });
const action = (label: string): Candidate => ({ id: `do-${label}`, group: 'actions', label, action: { kind: 'trash' } });
const create = (label: string): Candidate => ({ id: `new-${label}`, group: 'create', label, action: { kind: 'create', what: 'ticket' } });

const labels = (hits: Candidate[]) => hits.map((h) => h.label);

describe('paletteHits', () => {
  test('an empty query shows everything but the tickets', () => {
    const hits = paletteHits([ticket('GF-1', 'a ticket'), action('approve'), go('apps'), create('new app')], '');
    expect(labels(hits)).toEqual(['approve', 'apps', 'new app']);
  });

  test('an empty query gives every group a share of the cap, so a long one cannot bury the rest', () => {
    // the actions on a Ticket are nine or ten rows on their own; before this they took all eight
    const actions = Array.from({ length: 10 }, (_, i) => action(`act ${i + 1}`));
    const hits = paletteHits([...actions, go('board'), go('apps'), create('new ticket'), create('new app')], '');
    // grouped, every group present, and still eight rows — all three said by one assertion
    expect(hits.map((h) => h.group)).toEqual(['actions', 'actions', 'actions', 'actions', 'go to', 'go to', 'create', 'create']);
  });

  test('a group with more rows than its share keeps the ones it was built with first', () => {
    const actions = Array.from({ length: 10 }, (_, i) => action(`act ${i + 1}`));
    expect(labels(paletteHits([...actions, go('board')], '')).slice(0, 3)).toEqual(['act 1', 'act 2', 'act 3']);
  });

  test('the groups come in their fixed order however the candidates were built', () => {
    const hits = paletteHits([create('new ticket'), go('board'), ticket('GF-1', 'ticket one'), action('trash ticket')], 'ticket');
    expect(hits.map((h) => h.group)).toEqual(['tickets', 'actions', 'create']);
  });

  test('the key you typed comes first, whether you typed the prefix or only the number', () => {
    const all = [ticket('GF-1', 'the first'), ticket('GF-12', 'the twelfth'), ticket('GF-120', 'the hundred and twentieth')];
    expect(labels(paletteHits(all, 'GF-12'))[0]).toBe('the twelfth');
    expect(labels(paletteHits(all, '12'))[0]).toBe('the twelfth');
    // the others still match as substrings; the exact one is only lifted above them
    expect(labels(paletteHits(all, '12'))).toContain('the hundred and twentieth');
  });

  test('a case-insensitive substring of the title matches', () => {
    const all = [ticket('GF-1', 'Keyboard-first navigation'), ticket('GF-2', 'something else')];
    expect(labels(paletteHits(all, 'first nav'))).toEqual(['Keyboard-first navigation']);
    expect(labels(paletteHits(all, 'FIRST NAV'))).toEqual(['Keyboard-first navigation']);
    expect(labels(paletteHits(all, 'nothing here'))).toEqual([]);
  });

  test('command aliases match while preserving the visible name', () => {
    const command: Candidate = { id: 'link', group: 'actions', label: 'add implementation link', aliases: ['add link', 'add PR', 'add commit'], action: { kind: 'add-implementation-link' } };
    for (const query of ['add link', 'ADD PR', 'commit']) expect(labels(paletteHits([command], query))).toEqual(['add implementation link']);
  });

  test('a done or cancelled ticket sorts after the open ones', () => {
    const all = [ticket('GF-1', 'shipped one', true), ticket('GF-2', 'open one'), ticket('GF-3', 'cancelled one', true)];
    expect(labels(paletteHits(all, 'one'))).toEqual(['open one', 'shipped one', 'cancelled one']);
  });

  test('an exact key beats an open ticket, and a terminal exact key still comes first', () => {
    const all = [ticket('GF-2', 'open one'), ticket('GF-1', 'shipped one', true)];
    expect(labels(paletteHits(all, '1'))[0]).toBe('shipped one');
  });

  test('at most eight rows, however many match', () => {
    const many = Array.from({ length: 30 }, (_, i) => ticket(`GF-${i + 1}`, `ticket ${i + 1}`));
    expect(paletteHits(many, 'ticket')).toHaveLength(PALETTE_ROWS);
  });

  test('a typed query takes the top of the ranking, because you named what you wanted', () => {
    const many = Array.from({ length: 20 }, (_, i) => ticket(`GF-${i + 1}`, `thing ${i + 1}`));
    const hits = paletteHits([...many, go('thing page')], 'thing');
    expect(hits).toHaveLength(PALETTE_ROWS);
    expect(hits.every((h) => h.group === 'tickets')).toBe(true);
  });
});

describe('transitionRows', () => {
  test('every arrow out of the status, saying where it goes', () => {
    const rows = transitionRows('planning');
    expect(rows.find((r) => r.label === 'approve')?.note).toBe('ready');
    expect(new Set(labels(rows))).toEqual(new Set(['pick', 'shelve', 'approve', 'close', 'cancel']));
  });

  test('the moves that carry the ticket forward lead, because ⏎ takes the first row', () => {
    // out of `ready` the table's own order opens with `unapprove`; a blind `s ⏎` must not walk it backwards
    expect(labels(transitionRows('ready'))).toEqual(['start', 'close', 'unapprove', 'cancel']);
    expect(labels(transitionRows('planning'))).toEqual(['approve', 'close', 'pick', 'shelve', 'cancel']);
  });

  test('cancel is last wherever it sits in the table — it is a way of stopping, not a step', () => {
    for (const status of ['backlog', 'todo', 'planning', 'ready', 'building', 'review', 'done'] as const) {
      const rows = transitionRows(status);
      expect(rows.at(-1)?.label).toBe('cancel');
    }
    // a cancelled ticket has only `reopen`, and nothing to put last
    expect(labels(transitionRows('cancelled'))).toEqual(['reopen']);
  });
});

describe('a Selection in the palette (issue 03b)', () => {
  test('offers transitions, trash and the four moves — and nothing that is about one ticket', () => {
    const rows = selectionRows(['approve', 'cancel']);
    expect(rows.map((r) => r.id)).toEqual(['move-approve', 'move-cancel', 'act-trash', 'act-move-app', 'act-move-project', 'act-no-project', 'act-nowhere']);
    expect(rows.some((r) => r.action.kind === 'simple' || r.action.kind === 'blocked-by')).toBe(false);
    // every row that acts, acts on the set: nothing here reaches the Cursor's ticket
    expect(rows.filter((r) => r.action.kind !== 'nest').every((r) => r.action.kind === 'bulk')).toBe(true);
  });

  test('a nested pick offers every live target, and choosing a project is a move to that project', () => {
    const rows = selectionPlaceRows('project', [{ id: 4, name: 'Reader MVP' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toEqual({ kind: 'bulk', action: { kind: 'move', to: { kind: 'project', id: 4 } } });
  });
});
