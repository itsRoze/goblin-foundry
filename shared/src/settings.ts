import { z } from 'zod';

/** The one setting S1 has: the ticket-key prefix (`GF` in `GF-12`). */
export const DEFAULT_TICKET_PREFIX = 'GF';
export const TICKET_PREFIX_KEY = 'ticket_prefix';

/** Where the API listens by default; the API binds it, the CLI calls it. */
export const DEFAULT_PORT = 4747;

export const SettingsSchema = z.object({
  ticket_prefix: z.string().min(1).max(8),
});
export type Settings = z.infer<typeof SettingsSchema>;
