import { describe, expect, test } from 'bun:test';
import { ProblemError, fieldLabel, issuePath } from '../src/api';
import { appBody, appFormFields } from '../src/pages/Apps';
import type { Event } from '@goblin/shared';
import { describeEvent, submittedValues } from '../src/ui';

/**
 * A refusal names a field the way the screen does. The API keeps
 * `repository_url` (GF-8 decided against a migration), so the translation
 * lives here rather than in the schema.
 */
describe('fieldLabel', () => {
  test('the fields the GUI calls something else', () => {
    expect(fieldLabel('repository_url')).toBe('repository');
    expect(fieldLabel('default_branch')).toBe('branch');
  });

  test('every other name is its own label', () => {
    expect(fieldLabel('name')).toBe('name');
    expect(fieldLabel('description')).toBe('description');
  });

  test('a zod issue path is translated part by part, dots and indices included', () => {
    expect(issuePath(['repository_url'])).toBe('repository');
    expect(issuePath(['tickets', 0, 'status'])).toBe('tickets.0.status');
    expect(issuePath([])).toBe('');
  });
});

describe('ProblemError.sentence', () => {
  test("a 422's issues read as field: message, in the screen's words", () => {
    const e = new ProblemError(422, { issues: [{ path: ['repository_url'], message: 'wants a git remote' }] });
    expect(e.sentence).toBe('repository: wants a git remote');
  });

  test('several issues are one line; a pathless one is the body', () => {
    const e = new ProblemError(422, {
      issues: [
        { path: ['default_branch'], message: 'requires a repository_url' },
        { path: [], message: 'unknown field' },
      ],
    });
    expect(e.sentence).toBe('branch: requires a repository_url · body: unknown field');
  });

  test("a 409 falls back to its hint, which is the GUI's sentence for a refused intent", () => {
    expect(new ProblemError(409, { hint: 'a ticket in review does not go back to building' }).sentence).toBe('a ticket in review does not go back to building');
  });
});

/**
 * An App's branch is inert without a repository, because the API refuses that
 * pair. What the form sends has to agree with what the field shows (GF-8).
 */
describe('an inert field', () => {
  const send = (v: Record<string, string>) => appBody(submittedValues(appFormFields, v));

  test('the app form labels its fields the way a refusal names them', () => {
    expect(appFormFields.map((f) => f.label)).toEqual(['name', 'repository', 'branch', 'checkout', 'description']);
  });

  test('a branch is dropped while there is no repository, so the pair is never sent illegal', () => {
    expect(send({ name: 'A', repository_url: '', default_branch: 'main' })).toMatchObject({ repository_url: null, default_branch: null });
    expect(send({ name: 'A', repository_url: '   ', default_branch: 'main' })).toMatchObject({ default_branch: null });
  });

  test('clearing the repository of an app that had a branch clears the branch with it', () => {
    // the edit form opens on a stored pair, and the repository is emptied
    expect(send({ name: 'A', repository_url: '', default_branch: 'trunk' })).toMatchObject({ repository_url: null, default_branch: null });
  });

  test('a branch alongside a repository is sent, in either accepted shape', () => {
    for (const remote of ['https://github.com/o/r', 'git@github.com:o/r.git']) {
      expect(send({ name: 'A', repository_url: remote, default_branch: 'main' })).toMatchObject({ repository_url: remote, default_branch: 'main' });
    }
  });

  test('an empty Checkout field is a cleared Checkout, and a typed one is sent for the API to judge', () => {
    expect(send({ name: 'A', checkout: '' })).toMatchObject({ checkout: null });
    expect(send({ name: 'A', checkout: '   ' })).toMatchObject({ checkout: null });
    expect(send({ name: 'A', checkout: '/Users/roze/dev/x' })).toMatchObject({ checkout: '/Users/roze/dev/x' });
  });

  test('a form with no inert field sends everything it holds', () => {
    expect(submittedValues([{ name: 'a', label: 'a' }], { a: '1' })).toEqual({ a: '1' });
  });
});

/** An edit session folds what a sitting changed into one event (ADR-0008), so the Checkout's line cannot assume it is alone. */
describe('an App history line about its Checkout', () => {
  const line = (prior: Record<string, unknown>, next: Record<string, unknown>) =>
    describeEvent({ id: 1, entity_kind: 'app', entity_id: 1, kind: 'updated', actor: 'human', prior, new: next, at: '2026-11-05T00:00:00.000Z' } satisfies Event, () => 'an app');

  test('says where it was pointed, and from where', () => {
    expect(line({ checkout: null }, { checkout: '/a' })).toBe('checkout set to /a');
    expect(line({ checkout: '/a' }, { checkout: '/b' })).toBe('checkout /a → /b');
  });

  test('a cleared Checkout keeps its folder on the screen, since it is said nowhere else', () => {
    expect(line({ checkout: '/a' }, { checkout: null })).toBe('checkout cleared · was /a');
  });

  test('a sitting that ended where it began says so, rather than that it cleared one', () => {
    expect(line({ checkout: null }, { checkout: null })).toBe('checkout set and cleared');
    expect(line({ checkout: '/a' }, { checkout: '/a' })).toBe('checkout changed back to /a');
  });

  test('is still said when the sitting changed something else too', () => {
    expect(line({ checkout: null, description: 'old' }, { checkout: '/a', description: 'new' })).toBe('checkout set to /a · description edited');
    expect(line({ checkout: '/a', name: 'A' }, { checkout: null, name: 'B' })).toBe('checkout cleared · was /a · renamed A → B');
  });
});
