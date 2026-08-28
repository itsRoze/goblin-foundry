import type { Context } from 'hono';
import { z, type ZodType } from 'zod';
import { unprocessable } from './problems';

/** Parse and validate a JSON body; on failure the handler returns the 422 `Response` this yields. */
export async function parseBody<T extends ZodType>(c: Context, schema: T): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, response: unprocessable(c, [{ path: [], message: 'body must be JSON' }]) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: unprocessable(c, parsed.error) };
  return { ok: true, data: parsed.data };
}

/** `:id` route params are positive integers; anything else is a 404-shaped miss handled by the caller. */
export function idParam(c: Context): number | null {
  const n = Number(c.req.param('id'));
  return Number.isInteger(n) && n > 0 ? n : null;
}
