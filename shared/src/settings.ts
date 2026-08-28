import { z } from 'zod';

/** The one setting S1 has: the ticket-key prefix (`GF` in `GF-12`). */
export const DEFAULT_TICKET_PREFIX = 'GF';

export const SettingsSchema = z.object({
  ticket_prefix: z.string().min(1).max(8),
});
export type Settings = z.infer<typeof SettingsSchema>;
