import { expect, test } from 'bun:test';
import { defaultWorktreeBranch, worktreeBase, worktreeSlug } from '../src/worktree';

test("the slug turns every run outside letters, digits, `.`, `_` and `-` into one dash and trims dashes at both ends: Herdr's rule", () => {
  expect(worktreeSlug('gf-14-a_b.c')).toBe('gf-14-a_b.c');
  expect(worktreeSlug('feature/thing')).toBe('feature-thing');
  expect(worktreeSlug('feature//@@thing')).toBe('feature-thing');
  expect(worktreeSlug('/-feature/-')).toBe('feature');
  expect(worktreeSlug('--a--b--')).toBe('a--b');
  expect(worktreeSlug('@@')).toBe('');
});

test("the default branch is the recorded Worktree's, else the Branch Suggestion", () => {
  const ticket = { key: 'GF-14', title: 'Choose a policy', worktree_branch: null };
  expect(defaultWorktreeBranch(ticket)).toBe('gf-14-choose-a-policy');
  expect(defaultWorktreeBranch({ ...ticket, worktree_branch: 'stacked/work' })).toBe('stacked/work');
});

test("the default base is what was asked for, else the App's default branch, else left to the Checkout's own", () => {
  expect(worktreeBase('develop', { default_branch: 'main' })).toBe('develop');
  expect(worktreeBase(undefined, { default_branch: 'main' })).toBe('main');
  expect(worktreeBase(undefined, { default_branch: null })).toBeUndefined();
});
