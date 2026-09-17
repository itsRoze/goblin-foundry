import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ZodError } from 'zod';

/**
 * Errors are `application/problem+json` (ADR-0004): `422` with zod-style
 * `issues`, `409 {owner, hint}` for a refused intent, `404` otherwise.
 */
function problem(c: Context, status: ContentfulStatusCode, title: string, extra: Record<string, unknown> = {}) {
  c.header('content-type', 'application/problem+json');
  return c.body(JSON.stringify({ type: 'about:blank', title, status, ...extra }), status);
}

export interface Issue {
  path: (string | number)[];
  message: string;
}

export const notFound = (c: Context, detail = 'not found') => problem(c, 404, 'Not Found', { detail });

export const unprocessable = (c: Context, issues: Issue[] | ZodError) =>
  problem(c, 422, 'Unprocessable Entity', {
    issues: Array.isArray(issues) ? issues : issues.issues.flatMap(fromZod),
  });

/** One issue per field, so an unknown key (zod's `unrecognized_keys` lists them in `keys`) is addressable by `path` like any other. */
function fromZod(issue: ZodError['issues'][number]): Issue[] {
  const path = issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p));
  if (issue.code === 'unrecognized_keys') return issue.keys.map((key) => ({ path: [...path, key], message: 'unknown field' }));
  return [{ path, message: issue.message }];
}

/** A refused intent names its owner and what would let it through; the GUI shows `hint`. */
export const conflict = (c: Context, hint: string, owner = 'human') => problem(c, 409, 'Conflict', { owner, hint });

/** How many refusals a `hint` spells out before it counts the rest; `refusals` always carries them all. */
const HINTED = 3;

/**
 * A refused batch (ADR-0010): the same `409 {owner, hint}` a refused intent
 * gets, plus `refusals` — which Tickets stopped it, and why, one sentence
 * each. The hint leads with the fact that matters most: nothing changed.
 */
export function refusedBatch(c: Context, refusals: { key: string; reason: string }[], owner = 'human') {
  const said = refusals.slice(0, HINTED).map((r) => `${r.key}: ${r.reason}`);
  const more = refusals.length > HINTED ? ` · and ${refusals.length - HINTED} more` : '';
  return problem(c, 409, 'Conflict', { owner, hint: `nothing changed — ${said.join(' · ')}${more}`, refusals });
}

/** A write that failed and was rolled back: a definite answer, unlike a response that never arrives. */
export const failed = (c: Context, detail: string) => problem(c, 500, 'Internal Server Error', { detail });
