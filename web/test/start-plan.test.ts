import { describe, expect, test } from 'bun:test';
import type { AppBranches, CheckoutBranch } from '@goblin/shared';
import { baseChoices, branchChoices, branchNote, matching, planBranch, planLine } from '../src/start-plan';

const local = (name: string, checked_out: CheckoutBranch['checked_out'] = null): CheckoutBranch => ({ name, kind: 'local', local: name, checked_out });
const remote = (from: string, short: string): CheckoutBranch => ({ name: `${from}/${short}`, kind: 'remote', local: short, checked_out: null });

const read: AppBranches = {
  default: 'main',
  worktrees_in: '/roots/subway-reader',
  branches: [
    local('feature/two'),
    local('in-a-worktree', { folder: '/elsewhere/there', linked: true }),
    local('main', { folder: '/code/subway-reader', linked: false }),
    remote('origin', 'main'),
    remote('origin', 'only-there'),
    remote('another', 'only-there'),
  ],
};

describe('what the typed branch will come to', () => {
  test('a name nobody has will be created, in a folder named by its slug', () => {
    expect(planBranch('gf-7 parse the feed', read)).toEqual({ kind: 'new', branch: 'gf-7 parse the feed', folder: '/roots/subway-reader/gf-7-parse-the-feed' });
  });

  test('an existing local branch is checked out, into a folder named by its slug', () => {
    expect(planBranch('feature/two', read)).toEqual({ kind: 'existing', branch: 'feature/two', folder: '/roots/subway-reader/feature-two' });
  });

  test('a branch in a linked worktree is adopted, and that folder is the Worktree', () => {
    expect(planBranch('in-a-worktree', read)).toEqual({ kind: 'adopted', branch: 'in-a-worktree', folder: '/elsewhere/there' });
  });

  test('the branch the Checkout itself is on cannot be given a Worktree', () => {
    expect(planBranch('main', read)).toEqual({ kind: 'in-checkout', branch: 'main', folder: '/code/subway-reader' });
  });

  test("a name only a remote holds tracks it, and origin's copy leads, as the API's does", () => {
    expect(planBranch('only-there', read)).toEqual({ kind: 'tracking', branch: 'only-there', from: 'origin/only-there', folder: '/roots/subway-reader/only-there' });
  });

  test('a remote-tracking branch named in full means the local branch that follows it', () => {
    expect(planBranch('another/only-there', read)).toEqual({ kind: 'tracking', branch: 'only-there', from: 'another/only-there', folder: '/roots/subway-reader/only-there' });
    expect(planBranch('origin/main', read)).toEqual({ kind: 'in-checkout', branch: 'main', folder: '/code/subway-reader' });
  });

  test('blank names nothing, and spaces around a name are not part of it', () => {
    expect(planBranch('   ', read)).toBeNull();
    expect(planBranch('  feature/two ', read)?.branch).toBe('feature/two');
  });
});

describe('the sentence the modal says about it', () => {
  test('existing and created are told apart', () => {
    expect(planLine({ kind: 'new', branch: 'x', folder: '/f' })).toBe('new branch: it will be created');
    expect(planLine({ kind: 'existing', branch: 'x', folder: '/f' })).toBe('existing branch');
    expect(planLine({ kind: 'tracking', branch: 'x', from: 'origin/x', folder: '/f' })).toBe('existing on origin/x: a local branch will track it');
    expect(planLine({ kind: 'adopted', branch: 'x', folder: '/f' })).toBe('existing branch, already in a Worktree: that one is used');
    expect(planLine({ kind: 'in-checkout', branch: 'x', folder: '/f' })).toBe('checked out in the Checkout itself: git will refuse it');
  });
});

describe('what the two fields offer', () => {
  test('the branch field leaves out a remote copy of a local branch, which would only mean the local one', () => {
    expect(branchChoices(read).map((b) => b.name)).toEqual(['feature/two', 'in-a-worktree', 'main', 'origin/only-there', 'another/only-there']);
  });

  test('the base field offers every local and remote-tracking branch', () => {
    expect(baseChoices(read).map((b) => b.name)).toEqual(['feature/two', 'in-a-worktree', 'main', 'origin/main', 'origin/only-there', 'another/only-there']);
  });

  test('typing filters, whatever the case and wherever in the name', () => {
    expect(matching(baseChoices(read), 'ONLY').map((b) => b.name)).toEqual(['origin/only-there', 'another/only-there']);
    expect(matching(baseChoices(read), 'nothing like it')).toEqual([]);
    expect(matching(baseChoices(read), '  ').length).toBe(6);
  });

  test('a row says what makes it unlike the others', () => {
    const note = (name: string) => branchNote(read.branches.find((b) => b.name === name) as CheckoutBranch, read);
    expect(note('feature/two')).toBe('');
    expect(note('main')).toBe('default · checkout');
    expect(note('in-a-worktree')).toBe('worktree');
    expect(note('origin/main')).toBe('remote');
  });
});
