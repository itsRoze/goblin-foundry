import { z } from 'zod';
import { slugify } from './slug';

/** A suggestion only: no git branch is created or remembered by copying it. */
export const ticketBranchName = (ticket: { key: string; title: string }) => `${ticket.key.toLowerCase()}-${slugify(ticket.title)}`;

const implementationUrl = z.string().trim().max(2048).pipe(z.url())
  .refine((value) => /^https?:\/\//i.test(value), 'use an http or https URL')
  .transform((value) => new URL(value).href);

export const AddImplementationLinkBodySchema = z.strictObject({ url: implementationUrl });
export const ImplementationLinkSchema = z.object({
  id: z.number().int(),
  url: z.string(),
  created_at: z.string(),
});
export type ImplementationLink = z.infer<typeof ImplementationLinkSchema>;
