import { z } from 'zod';

/** Who performed a mutation (GLOSSARY.md "Actor"). Sent as the `X-Goblin-Actor` header; absent means `human`. */
export const ACTOR_HEADER = 'X-Goblin-Actor';
export const ActorSchema = z.enum(['human', 'agent']);
export type Actor = z.infer<typeof ActorSchema>;
export const DEFAULT_ACTOR: Actor = 'human';

/** The row `updated_at` a `PATCH` was judged on; the edit is then pinned to that version and refused with a 409 if the row has moved (ADR-0001, GF-79). Absent means the request's own read. */
export const JUDGED_HEADER = 'X-Goblin-Updated-At';
