import type { Context, Next } from 'hono';
import { ACTOR_HEADER, ActorSchema, DEFAULT_ACTOR, type Actor } from '@goblin/shared';
import { unprocessable } from './problems';

export type ActorEnv = { Variables: { actor: Actor } };

/** `X-Goblin-Actor: human|agent`; absent → `human`; anything else → 422. */
export async function actorMiddleware(c: Context<ActorEnv>, next: Next) {
  const raw = c.req.header(ACTOR_HEADER);
  const parsed = ActorSchema.safeParse(raw ?? DEFAULT_ACTOR);
  if (!parsed.success) return unprocessable(c, [{ path: [ACTOR_HEADER], message: 'expected human or agent' }]);
  c.set('actor', parsed.data);
  await next();
}
