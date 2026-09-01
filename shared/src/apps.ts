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

const appFields = {
  name: z.string().trim().min(1).max(200),
  repository_url: z.url().nullable(),
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
