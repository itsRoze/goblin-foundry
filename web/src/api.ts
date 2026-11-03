import type { ZodType, z } from 'zod';
import { JUDGED_HEADER } from '@goblin/shared';

/** A problem+json error (ADR-0004); `hint` is what the GUI shows for a 409. */
export class ProblemError extends Error {
  constructor(
    public status: number,
    public problem: { title?: string; detail?: string; hint?: string; issues?: { path: (string | number)[]; message: string }[]; refusals?: { key: string; reason: string }[] },
  ) {
    super(problem.hint ?? problem.detail ?? problem.title ?? `HTTP ${status}`);
  }
  /**
   * One line for an inline refusal / validation message. Not `line`: WebKit
   * gives every `Error` own `line`, `column` and `sourceURL` properties, and an
   * own property shadows a prototype getter — so on iOS Safari a refusal named
   * `line` read as the source line the error was thrown from (issue 11).
   */
  get sentence(): string {
    if (this.problem.issues?.length) return this.problem.issues.map((i) => `${issuePath(i.path) || 'body'}: ${i.message}`).join(' · ');
    return this.message;
  }
}

/**
 * What the GUI calls a field the API names differently. A refusal names the
 * field the way the screen does, or it names nothing the reader can find: the
 * API keeps `repository_url` (GF-8 decided not to migrate it), while every
 * surface a human reads says `repository`. The form labels its fields from
 * here too, so the sentence under a refused field and the label above it
 * cannot drift apart.
 */
const FIELD_LABELS: Record<string, string> = { repository_url: 'repository', default_branch: 'branch' };

export const fieldLabel = (name: string): string => FIELD_LABELS[name] ?? name;

/** A zod issue's path, in the screen's words. */
export const issuePath = (path: (string | number)[]): string => path.map((p) => fieldLabel(String(p))).join('.');

/** The sentence for a call that got no answer at all: whether the request landed is unknown, so it claims nothing about what changed. */
const UNREACHED = 'could not reach the API; try again';

/** The API's own work on the largest body it takes is under 10 ms, so this is the link: 200 KB crosses a 256 kbit/s one in about 6 s. */
const PATCH_BOUND_MS = 10_000;

interface Call {
  body?: unknown;
  /** The row `updated_at` the write was judged on; the API refuses the write if the row has moved since. */
  judged?: string;
  signal?: AbortSignal;
}

async function call(method: string, path: string, { body, judged, signal }: Call = {}): Promise<unknown> {
  let text: string;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(judged === undefined ? {} : { [JUDGED_HEADER]: judged }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    text = await res.text();
  } catch {
    throw new ProblemError(0, { detail: UNREACHED });
  }
  const data: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ProblemError(res.status, (data ?? {}) as ProblemError['problem']);
  return data;
}

export async function get<T extends ZodType>(path: string, schema: T): Promise<z.infer<T>> {
  return schema.parse(await call('GET', path));
}
export const post = (path: string, body?: unknown) => call('POST', path, { body });
/** A whole body sent again lands the same, so a save with no answer in the bound is given up on and told as a lost answer; a create sent again would make two. */
export const patch = (path: string, body: unknown, judged?: string) => call('PATCH', path, { body, judged, signal: AbortSignal.timeout(PATCH_BOUND_MS) });
export const del = (path: string) => call('DELETE', path);
