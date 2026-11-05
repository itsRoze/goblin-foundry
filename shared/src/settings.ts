import { z } from 'zod';

/** The ticket-key prefix (`GF` in `GF-12`). */
export const DEFAULT_TICKET_PREFIX = 'GF';
export const TICKET_PREFIX_KEY = 'ticket_prefix';

/** Where Worktrees are made: Goblin's own folder, so nothing lands in another tool's. Kept as written, `~` included, and expanded where it is used. */
export const DEFAULT_WORKTREE_ROOT = '~/.goblin/worktrees';
export const WORKTREE_ROOT_KEY = 'worktree_root';

/** Where the API listens by default; the API binds it, the CLI calls it. */
export const DEFAULT_PORT = 4747;

export const SettingsSchema = z.object({
  ticket_prefix: z.string().min(1).max(8),
  worktree_root: z.string().min(1),
});
export type Settings = z.infer<typeof SettingsSchema>;

/** Letters and digits, first character a letter; stored uppercase (`sr` → `SR`). */
export const TICKET_PREFIX_PATTERN = /^[A-Z][A-Z0-9]{0,7}$/;
export const TICKET_PREFIX_SHAPE = 'a letter followed by up to 7 letters or digits';

/** A server's working directory is nobody's idea of where they are, so a relative root means nothing. */
export const WORKTREE_ROOT_PATTERN = /^(~$|~\/|\/)[^\0]*$/;
export const WORKTREE_ROOT_SHAPE = 'an absolute folder, or one under ~';

export const PatchSettingsBodySchema = z
  .strictObject({
    ticket_prefix: z.string().trim().toUpperCase().regex(TICKET_PREFIX_PATTERN, TICKET_PREFIX_SHAPE).optional(),
    worktree_root: z.string().trim().regex(WORKTREE_ROOT_PATTERN, WORKTREE_ROOT_SHAPE).optional(),
  })
  .refine((body) => body.ticket_prefix !== undefined || body.worktree_root !== undefined, 'name at least one setting');
export type PatchSettingsBody = z.infer<typeof PatchSettingsBodySchema>;
