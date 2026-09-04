import { describe, expect, test } from 'bun:test';
import { DEFAULT_BOARD_STATUSES, parseTicketFilter, serialiseTicketFilter, type TicketFilter } from '../src/filters';

/** The one parser the API, the web and `goblin` share (issue 06). */
describe('parseTicketFilter', () => {
  const ok = (params: Record<string, string>): TicketFilter => {
    const parsed = parseTicketFilter(params);
    if (!parsed.ok) throw new Error(`refused: ${JSON.stringify(parsed.issues)}`);
    return parsed.filter;
  };
  const issues = (params: Record<string, string>) => {
    const parsed = parseTicketFilter(params);
    return parsed.ok ? [] : parsed.issues;
  };

  test('nothing given is no filter at all', () => {
    expect(ok({})).toEqual({});
    expect(parseTicketFilter(new URLSearchParams())).toEqual({ ok: true, filter: {} });
  });

  test('an empty value is unset, never a filter on emptiness', () => {
    expect(ok({ app_id: '', project_id: '', status: '', q: '' })).toEqual({});
    expect(ok({ status: ' , ' })).toEqual({});
    expect(ok({ q: '   ' })).toEqual({});
  });

  test('an id is a number and the literal null is "has none"', () => {
    expect(ok({ app_id: '3', project_id: 'null' })).toEqual({ app_id: 3, project_id: null });
  });

  test('the wire takes an id, never the address the GUI writes', () => {
    expect(issues({ app_id: 'subway-reader-3' })).toEqual([{ path: ['app_id'], message: 'expected an id or null' }]);
    expect(issues({ project_id: '1.5' })).toEqual([{ path: ['project_id'], message: 'expected an id or null' }]);
    expect(issues({ app_id: '-1' })).toEqual([{ path: ['app_id'], message: 'expected an id or null' }]);
  });

  test('slugs are the browser address only, and only when asked for', () => {
    expect(parseTicketFilter({ app_id: 'subway-reader-3' }, { slugs: true })).toEqual({ ok: true, filter: { app_id: 3 } });
    expect(parseTicketFilter({ project_id: 'null' }, { slugs: true })).toEqual({ ok: true, filter: { project_id: null } });
    expect(parseTicketFilter({ app_id: 'subway-reader' }, { slugs: true })).toEqual({
      ok: false,
      issues: [{ path: ['app_id'], message: 'expected an id or null' }],
    });
  });

  test('a status set comes back deduped, in lifecycle order', () => {
    expect(ok({ status: 'review,backlog,review' })).toEqual({ status: ['backlog', 'review'] });
    expect(ok({ status: ' ready , building ' })).toEqual({ status: ['ready', 'building'] });
  });

  test('an unknown status is refused on the field it came in on', () => {
    expect(issues({ status: 'backlog,shipped' })).toEqual([{ path: ['status'], message: 'shipped is not a status' }]);
  });

  test('q is trimmed', () => {
    expect(ok({ q: '  e-ink  ' })).toEqual({ q: 'e-ink' });
  });

  test('every bad field is named at once', () => {
    expect(issues({ app_id: 'x', status: 'nope' })).toEqual([
      { path: ['app_id'], message: 'expected an id or null' },
      { path: ['status'], message: 'nope is not a status' },
    ]);
  });
});

describe('serialiseTicketFilter', () => {
  test('canonical order, empties omitted, so equal filters make equal bookmarks', () => {
    expect(serialiseTicketFilter({ q: 'rss', status: ['ready', 'backlog'], project_id: 2, app_id: 1 })).toBe('app_id=1&project_id=2&status=backlog,ready&q=rss');
  });

  test('nothing set is an empty string, not a bare ?', () => {
    expect(serialiseTicketFilter({})).toBe('');
    expect(serialiseTicketFilter({ status: [], q: '' })).toBe('');
  });

  test('null is written as the literal the parser reads back', () => {
    expect(serialiseTicketFilter({ app_id: null })).toBe('app_id=null');
  });

  test('a round trip is a fixed point', () => {
    const filter: TicketFilter = { app_id: null, project_id: 4, status: ['todo', 'done'], q: '100% of the _rest_' };
    const written = serialiseTicketFilter(filter);
    expect(parseTicketFilter(new URLSearchParams(written))).toEqual({ ok: true, filter });
  });
});

test('the board default is the seven live statuses', () => {
  expect(DEFAULT_BOARD_STATUSES).toEqual(['backlog', 'todo', 'planning', 'ready', 'building', 'review', 'done']);
});
