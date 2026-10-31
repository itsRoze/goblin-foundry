import { z } from 'zod';

/** Who performed a mutation (GLOSSARY.md "Actor"). Sent as the `X-Goblin-Actor` header; absent means `human`. */
export const ACTOR_HEADER = 'X-Goblin-Actor';
export const ActorSchema = z.enum(['human', 'agent']);
export type Actor = z.infer<typeof ActorSchema>;
export const DEFAULT_ACTOR: Actor = 'human';
