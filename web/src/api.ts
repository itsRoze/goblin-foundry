import type { ZodType, z } from 'zod';

/** A problem+json error (ADR-0004); `hint` is what the GUI shows for a 409. */
export class ProblemError extends Error {
  constructor(
    public status: number,
    public problem: { title?: string; detail?: string; hint?: string; issues?: { path: (string | number)[]; message: string }[] },
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
    if (this.problem.issues?.length) return this.problem.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join(' · ');
    return this.message;
  }
}

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ProblemError(res.status, (data ?? {}) as ProblemError['problem']);
  return data;
}

export async function get<T extends ZodType>(path: string, schema: T): Promise<z.infer<T>> {
  return schema.parse(await call('GET', path));
}
export const post = (path: string, body?: unknown) => call('POST', path, body);
export const patch = (path: string, body: unknown) => call('PATCH', path, body);
export const del = (path: string) => call('DELETE', path);
