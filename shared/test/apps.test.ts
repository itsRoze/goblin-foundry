import { describe, expect, test } from 'bun:test';
import {
  CreateAppBodySchema,
  DEFAULT_BRANCH_NEEDS_REPOSITORY,
  REPOSITORY_EXAMPLES,
  REPOSITORY_WANTS,
  branchWithoutRepository,
  parseGitRemote,
  repositoryHref,
} from '../src/apps';

/** The grammar the field, the API, the CLI and the App view's link all read (GF-8). */
describe('parseGitRemote', () => {
  test('the two shapes a human has to hand', () => {
    expect(parseGitRemote('https://github.com/o/r')).toEqual({ host: 'github.com', path: 'o/r' });
    expect(parseGitRemote('https://github.com/o/r.git')).toEqual({ host: 'github.com', path: 'o/r.git' });
    expect(parseGitRemote('git@github.com:o/r.git')).toEqual({ host: 'github.com', path: 'o/r.git' });
  });

  test('the shapes that pass without being advertised', () => {
    expect(parseGitRemote('http://git.internal/o/r.git')).toEqual({ host: 'git.internal', path: 'o/r.git' });
    expect(parseGitRemote('ssh://git@github.com/o/r.git')).toEqual({ host: 'github.com', path: 'o/r.git' });
    expect(parseGitRemote('ssh://git@github.com:2222/o/r.git')).toEqual({ host: 'github.com', path: 'o/r.git' });
    expect(parseGitRemote('git://host/o/r.git')).toEqual({ host: 'host', path: 'o/r.git' });
  });

  test('an SSH host alias is taken naively — only ~/.ssh/config could resolve it', () => {
    expect(parseGitRemote('git@github.com-itsRoze:o/r.git')).toEqual({ host: 'github.com-itsRoze', path: 'o/r.git' });
  });

  test('a bare host:path is refused — without user@, javascript:alert(1) is a host and a path', () => {
    expect(parseGitRemote('github.com:o/r.git')).toBeNull();
  });

  test('other schemes, local paths and bare words are refused', () => {
    expect(parseGitRemote('javascript:alert(1)')).toBeNull();
    expect(parseGitRemote('mailto:a@b.c')).toBeNull();
    expect(parseGitRemote('file:///x')).toBeNull();
    expect(parseGitRemote('/Users/roze/dev/x')).toBeNull();
    expect(parseGitRemote('../x')).toBeNull();
    expect(parseGitRemote('github.com/o/r')).toBeNull();
    expect(parseGitRemote('')).toBeNull();
  });
});

/** The href is only ever http(s): a stored string never reaches `href` raw. */
describe('repositoryHref', () => {
  test('an http(s) remote links as typed — no canonicalising', () => {
    expect(repositoryHref('https://github.com/o/r.git')).toBe('https://github.com/o/r.git');
    expect(repositoryHref('https://github.com/o/r/')).toBe('https://github.com/o/r/');
    expect(repositoryHref('http://git.internal/o/r')).toBe('http://git.internal/o/r');
  });

  test('every other accepted shape derives an https link, user and port dropped, .git off', () => {
    expect(repositoryHref('git@github.com:o/r.git')).toBe('https://github.com/o/r');
    expect(repositoryHref('ssh://git@github.com:2222/o/r.git')).toBe('https://github.com/o/r');
    expect(repositoryHref('git://host/o/r.git')).toBe('https://host/o/r');
  });

  test('an alias derives a dead link rather than a guess', () => {
    expect(repositoryHref('git@github.com-itsRoze:o/r.git')).toBe('https://github.com-itsRoze/o/r');
  });

  test('a value the old rule let through has no link at all', () => {
    expect(repositoryHref('javascript:alert(1)')).toBeNull();
    expect(repositoryHref('not a url')).toBeNull();
  });
});

describe('the repository_url field', () => {
  const create = (repository_url: string) => CreateAppBodySchema.safeParse({ name: 'X', repository_url });
  const refusal = (repository_url: string) => {
    const parsed = create(repository_url);
    return parsed.success ? [] : parsed.error.issues.map((i) => ({ path: i.path, message: i.message }));
  };

  test('accepts what git prints, stored as typed but trimmed', () => {
    for (const remote of ['https://github.com/o/r', 'https://github.com/o/r.git', 'git@github.com:o/r.git', 'ssh://git@github.com/o/r.git', 'git://host/o/r.git', 'git@github.com-itsRoze:o/r.git']) {
      expect(create(remote)).toMatchObject({ success: true, data: { repository_url: remote } });
    }
    expect(create('  git@github.com:o/r.git  ')).toMatchObject({ success: true, data: { repository_url: 'git@github.com:o/r.git' } });
  });

  test('null is a local-only app, and the field may be left out', () => {
    expect(CreateAppBodySchema.safeParse({ name: 'X', repository_url: null }).success).toBe(true);
    expect(CreateAppBodySchema.safeParse({ name: 'X' }).success).toBe(true);
  });

  test('a refusal names the two shapes a human has to hand', () => {
    for (const bad of ['github.com:o/r.git', 'javascript:alert(1)', 'mailto:a@b.c', 'file:///x', '/Users/roze/dev/x', 'github.com/o/r']) {
      expect(refusal(bad)).toEqual([{ path: ['repository_url'], message: REPOSITORY_WANTS }]);
    }
    expect(REPOSITORY_WANTS).toBe('wants a git remote — https://host/owner/repo or git@host:owner/repo.git');
  });

  test('the refusal and the field that invites it teach the same two examples', () => {
    expect(REPOSITORY_WANTS).toContain(REPOSITORY_EXAMPLES);
    // and both examples are values the field actually takes
    for (const example of REPOSITORY_EXAMPLES.split(' or ')) expect(parseGitRemote(example)).not.toBeNull();
  });
});

describe('branchWithoutRepository', () => {
  test('a default branch only makes sense alongside a remote, whatever its shape', () => {
    expect(branchWithoutRepository({ default_branch: 'main' })).toBe(true);
    expect(branchWithoutRepository({ default_branch: 'main', repository_url: 'git@github.com:o/r.git' })).toBe(false);
    expect(branchWithoutRepository({ repository_url: null })).toBe(false);
    expect(DEFAULT_BRANCH_NEEDS_REPOSITORY).toBe('default_branch requires a repository_url');
  });
});
