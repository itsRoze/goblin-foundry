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

/** Herdr's rule, so a Worktree root pointed at Herdr's folder produces Herdr's paths. */
export const worktreeSlug = (branch: string): string => branch.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

/** Stopping and resuming lands in the same place, because the recorded branch comes first. */
export const defaultWorktreeBranch = (ticket: { key: string; title: string; worktree_branch: string | null }): string => ticket.worktree_branch ?? ticketBranchName(ticket);

/** `undefined` leaves it to the Checkout's own default branch, which only git can say. */
export const worktreeBase = (asked: string | undefined, app: { default_branch: string | null }): string | undefined => asked ?? app.default_branch ?? undefined;
