import { worktreeSlug, type AppBranches, type CheckoutBranch } from '@goblin/shared';

/**
 * What a typed branch will come to, worked out from the branches read the way
 * `makeWorktree` in the API works it out, so the modal can say it before anything
 * is made. The API decides in the end; this is what the operator is told first.
 */
export type BranchPlan = {
  /** The local branch, which is not always what was typed. */
  branch: string;
  /** Where the Worktree will be. */
  folder: string;
} & ({ kind: 'new' | 'existing' | 'adopted' | 'in-checkout' } | { kind: 'tracking'; from: string });

export function planBranch(typed: string, { branches, worktrees_in }: AppBranches): BranchPlan | null {
  const asked = typed.trim();
  if (asked === '') return null;
  const named = branches.find((b) => b.name === asked);
  const branch = named?.local ?? asked;
  const folder = `${worktrees_in}/${worktreeSlug(branch)}`;

  const own = branches.find((b) => b.kind === 'local' && b.name === branch);
  if (own?.checked_out) return { kind: own.checked_out.linked ? 'adopted' : 'in-checkout', branch, folder: own.checked_out.folder };
  if (own) return { kind: 'existing', branch, folder };
  const tracked = named ?? branches.find((b) => b.kind === 'remote' && b.local === branch);
  return tracked ? { kind: 'tracking', branch, from: tracked.name, folder } : { kind: 'new', branch, folder };
}

export function planLine(plan: BranchPlan): string {
  switch (plan.kind) {
    case 'new':
      return 'new branch: it will be created';
    case 'existing':
      return 'existing branch';
    case 'tracking':
      return `existing on ${plan.from}: a local branch will track it`;
    case 'adopted':
      return 'existing branch, already in a Worktree: that one is used';
    case 'in-checkout':
      return 'checked out in the Checkout itself: git will refuse it';
  }
}

/** The default leads, because it is what is usually wanted and a long list would bury it. */
const defaultFirst = (branches: CheckoutBranch[], fallback: string | null) => [...branches.filter((b) => b.name === fallback), ...branches.filter((b) => b.name !== fallback)];

/** A remote's copy of a local branch is left out: naming it would mean the local one. */
export function branchChoices({ branches, default: fallback }: AppBranches): CheckoutBranch[] {
  const locals = new Set(branches.filter((b) => b.kind === 'local').map((b) => b.name));
  return defaultFirst(branches.filter((b) => b.kind === 'local' || !locals.has(b.local)), fallback);
}

export const baseChoices = ({ branches, default: fallback }: AppBranches): CheckoutBranch[] => defaultFirst(branches, fallback);

export function matching(choices: CheckoutBranch[], query: string): CheckoutBranch[] {
  const wanted = query.trim().toLowerCase();
  return choices.filter((b) => b.name.toLowerCase().includes(wanted));
}

/** What a row says beside its name: only what sets it apart. */
export function branchNote(branch: CheckoutBranch, { default: fallback }: AppBranches): string {
  const place = branch.kind === 'remote' ? 'remote' : branch.checked_out === null ? null : branch.checked_out.linked ? 'worktree' : 'checkout';
  return [branch.name === fallback ? 'default' : null, place].filter((part) => part !== null).join(' · ');
}
