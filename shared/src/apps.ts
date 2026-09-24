import { z } from 'zod';
import { designBody, designField } from './design';

const timestamps = {
  archived_at: z.string().nullable(),
  trashed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
};

export const AppSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  repository_url: z.string().nullable(),
  default_branch: z.string().nullable(),
  description: z.string(),
  ...timestamps,
});
export type App = z.infer<typeof AppSchema>;

/**
 * A git remote, in whatever form git prints it — the value closest to a human's
 * hand (GF-8). `<user>@<host>:<path>` is git's SCP form; `user@` is required,
 * because without it `javascript:alert(1)` is a host and a path and the
 * narrowing is gone.
 */
const SCP_REMOTE = /^[^@/:]+@([^@/:]+):(.+)$/;
const REMOTE_SCHEMES = new Set(['https:', 'http:', 'ssh:', 'git:']);

/** The accepted set, as `{host, path}`; `null` is a refusal. Nothing here rewrites what was typed. */
export function parseGitRemote(remote: string): { host: string; path: string } | null {
  const value = remote.trim();
  const scp = SCP_REMOTE.exec(value);
  if (scp) return { host: scp[1]!, path: scp[2]! };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!REMOTE_SCHEMES.has(url.protocol) || !url.hostname) return null;
  return { host: url.hostname, path: url.pathname.replace(/^\/+/, '') };
}

/**
 * The two shapes a human has to hand, in one place: the field teaches them
 * before the value is typed and the refusal repeats them after, and a
 * correction that arrives in different words than the invitation reads as a
 * new rule rather than the same one. `ssh://` and `git://` pass without being
 * advertised.
 */
export const REPOSITORY_EXAMPLES = 'https://host/owner/repo or git@host:owner/repo.git';
export const REPOSITORY_WANTS = `wants a git remote — ${REPOSITORY_EXAMPLES}`;

/**
 * Where a remote points a browser. An `http(s)` value links as typed; every
 * other shape derives `https://<host>/<path>` (user, port and `.git` dropped),
 * which is dead for an SSH host alias — only `~/.ssh/config` could resolve one.
 * Invariant: the result is only ever `http(s)`, so a stored string never
 * reaches `href` raw. `null` when it parses as no remote at all — reads are
 * lenient, so a row stored under the old rule still loads.
 */
export function repositoryHref(remote: string): string | null {
  const parsed = parseGitRemote(remote);
  if (!parsed) return null;
  const value = remote.trim();
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${parsed.host}/${parsed.path.replace(/\.git$/, '')}`;
}

const appFields = {
  name: z.string().trim().min(1).max(200),
  repository_url: z
    .string()
    .trim()
    .refine((v) => parseGitRemote(v) !== null, REPOSITORY_WANTS)
    .nullable(),
  default_branch: z.string().trim().min(1).max(200).nullable(),
  description: z.string().max(10_000),
};

/** `archived_at`/`trashed_at` are never writable through a body (strict object → 422); use the intents. */
export const CreateAppBodySchema = z.strictObject({
  name: appFields.name,
  repository_url: appFields.repository_url.optional(),
  default_branch: appFields.default_branch.optional(),
  description: appFields.description.optional(),
});
export type CreateAppBody = z.infer<typeof CreateAppBodySchema>;

export const PatchAppBodySchema = z.strictObject({
  name: appFields.name.optional(),
  repository_url: appFields.repository_url.optional(),
  default_branch: appFields.default_branch.optional(),
  description: appFields.description.optional(),
});
export type PatchAppBody = z.infer<typeof PatchAppBodySchema>;

/** A default branch only makes sense alongside a repository URL. Checked on the merged record. */
export const DEFAULT_BRANCH_NEEDS_REPOSITORY = 'default_branch requires a repository_url';
export function branchWithoutRepository(app: { repository_url?: string | null; default_branch?: string | null }) {
  return Boolean(app.default_branch) && !app.repository_url;
}

export const ProjectSchema = z.object({
  id: z.number().int(),
  app_id: z.number().int().nullable(),
  name: z.string(),
  description: z.string(),
  /** The Project Design: markdown, or `null` when nobody has written one (ADR-0005). */
  design: designField,
  ...timestamps,
});
export type Project = z.infer<typeof ProjectSchema>;

export const CreateProjectBodySchema = z.strictObject({
  name: appFields.name,
  description: appFields.description.optional(),
  design: designBody.optional(),
  app_id: z.number().int().nullable().optional(),
});
export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;

export const PatchProjectBodySchema = z.strictObject({
  name: appFields.name.optional(),
  description: appFields.description.optional(),
  design: designBody.optional(),
  app_id: z.number().int().nullable().optional(),
});
export type PatchProjectBody = z.infer<typeof PatchProjectBodySchema>;
