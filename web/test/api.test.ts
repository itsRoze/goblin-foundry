import { describe, expect, test } from 'bun:test';
import { ProblemError, fieldLabel, issuePath } from '../src/api';
import { appBody, appFormFields } from '../src/pages/Apps';
import { submittedValues } from '../src/ui';

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
    expect(new ProblemError(409, { hint: "approve is the human's move" }).sentence).toBe("approve is the human's move");
  });
});

/**
 * An App's branch is inert without a repository, because the API refuses that
 * pair. What the form sends has to agree with what the field shows (GF-8).
 */
describe('an inert field', () => {
  const send = (v: Record<string, string>) => appBody(submittedValues(appFormFields, v));

  test('the app form labels its fields the way a refusal names them', () => {
    expect(appFormFields.map((f) => f.label)).toEqual(['name', 'repository', 'branch', 'description']);
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

  test('a form with no inert field sends everything it holds', () => {
    expect(submittedValues([{ name: 'a', label: 'a' }], { a: '1' })).toEqual({ a: '1' });
  });
});
