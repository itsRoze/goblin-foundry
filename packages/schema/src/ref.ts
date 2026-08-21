/**
 * A ticket ref names a ticket the same way in a URL, in the API, in a branch
 * name, in a commit message and in an agent's prompt: `<KEY>-<shortId>`.
 * These two functions are the only place that format is spelled out.
 */

const REF_RE = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/;

export function formatRef(key: string, shortId: number): string {
  return `${key.toUpperCase()}-${shortId}`;
}

export function parseRef(ref: string): { key: string; shortId: number } | null {
  const m = REF_RE.exec(ref.trim());
  if (!m) return null;
  return { key: m[1]!.toUpperCase(), shortId: Number(m[2]) };
}

/**
 * A project key derived from its slug: the initials of a multi-word slug, or
 * the first three letters of a single-word one, uppercased. `taken` breaks a
 * collision by appending 2, 3, ... to the base — the caller decides what is
 * "taken" (existing project keys, usually).
 */
export function deriveProjectKey(slug: string, taken: Iterable<string> = []): string {
  const words = slug.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const base = words.length > 1
    ? words.slice(0, 4).map(w => w[0]!).join('').toUpperCase()
    : (words[0] ?? 'PRJ').slice(0, 3).toUpperCase() || 'PRJ';

  const takenSet = new Set([...taken].map(k => k.toUpperCase()));
  if (!takenSet.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`;
    if (!takenSet.has(candidate)) return candidate;
  }
}

export type RefCandidate = { key: string; shortId: number };

export type RefResolution<T> =
  | { status: 'unique'; candidate: T }
  | { status: 'ambiguous'; candidates: T[] }
  | { status: 'none' };

/**
 * Resolves user input that may be a canonical ref (`FAC-10`) or a legacy bare
 * number (`10`, `#10`) against the candidates it could mean. A canonical ref
 * is unambiguous by construction — the project key pins it to one project;
 * a bare number is ambiguous whenever more than one project has it.
 */
export function resolveRef<T extends RefCandidate>(input: string, candidates: T[]): RefResolution<T> {
  const parsed = parseRef(input);
  if (parsed) {
    const match = candidates.find(c => c.key.toUpperCase() === parsed.key && c.shortId === parsed.shortId);
    return match ? { status: 'unique', candidate: match } : { status: 'none' };
  }

  const bare = /^#?(\d+)$/.exec(input.trim());
  if (!bare) return { status: 'none' };
  const shortId = Number(bare[1]);
  const matches = candidates.filter(c => c.shortId === shortId);
  if (matches.length === 0) return { status: 'none' };
  if (matches.length === 1) return { status: 'unique', candidate: matches[0]! };
  return { status: 'ambiguous', candidates: matches };
}
