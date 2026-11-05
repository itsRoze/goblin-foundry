import { z } from 'zod';
import { ticketBranchName } from './implementation';

/** Whether git would take it is git's to say. A NUL it never gets to see: no process can be handed one. */
const refName = z.string().trim().min(1).max(255).regex(/^[^\0]*$/, 'no NUL in a branch name');

/** The optional body of `start` that asks for a Worktree; `{}` asks with every default. */
export const StartWorktreeBodySchema = z.strictObject({
  branch: refName.optional(),
  /** What a new branch is cut from. An existing branch has no use for one. */
  base: refName.optional(),
});
export type StartWorktreeBody = z.infer<typeof StartWorktreeBodySchema>;

/**
 * One branch of a Checkout: its own name, or `origin/x` for a remote-tracking
 * one. `local` is the local branch it is, or would become. `checked_out` is
 * where it is checked out, and `linked: false` means the Checkout itself, which
 * a Ticket is never worked in.
 */
export const CheckoutBranchSchema = z.object({
  name: z.string(),
  kind: z.enum(['local', 'remote']),
  local: z.string(),
  checked_out: z.object({ folder: z.string(), linked: z.boolean() }).nullable(),
});
export type CheckoutBranch = z.infer<typeof CheckoutBranchSchema>;

/** `GET /api/apps/:id/branches`, read from the Checkout live: local branches first, then remote-tracking ones with `origin` leading. */
export const AppBranchesSchema = z.object({
  /** The Checkout's own default branch. */
  default: z.string(),
  /** The folder a new Worktree of this Checkout is made in, under the Worktree root. */
  worktrees_in: z.string(),
  branches: z.array(CheckoutBranchSchema),
  /** False until the first commit, as `git init` leaves it: nothing a new branch could be cut from, so no Worktree can be made. A Checkout with no branch can still have one. */
  has_commit: z.boolean(),
});
export type AppBranches = z.infer<typeof AppBranchesSchema>;

/** Herdr's rule, so a Worktree root pointed at Herdr's folder produces Herdr's paths. */
export const worktreeSlug = (branch: string): string => branch.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

/** Stopping and resuming lands in the same place, because the recorded branch comes first. */
export const defaultWorktreeBranch = (ticket: { key: string; title: string; worktree_branch: string | null }): string => ticket.worktree_branch ?? ticketBranchName(ticket);

/** `undefined` leaves it to the Checkout's own default branch, which only git can say. */
export const worktreeBase = (asked: string | undefined, app: { default_branch: string | null }): string | undefined => asked ?? app.default_branch ?? undefined;
