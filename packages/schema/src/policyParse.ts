import { parseDocument } from 'yaml';
import {
  KNOWN_TOP_SECTIONS, PHASE_NAMES, PHASE_POLICY_FIELDS, RETIRED_KEYS, SECTION_FIELDS,
  policyOverride as policyOverrideSchema, type PolicyOverride,
} from './policy.ts';

/** One parse problem: a human-readable message, and the snake_case key it names (if any). */
export type PolicyProblem = { message: string; key?: string };

export type ParseResult =
  | { ok: true; override: PolicyOverride; warnings: PolicyProblem[] }
  | { ok: false; errors: PolicyProblem[]; warnings: PolicyProblem[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

function camelToSnake(s: string): string {
  return s.replace(/([A-Z])/g, (_m, c: string) => `_${c.toLowerCase()}`);
}

function snakeToCamelDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeToCamelDeep);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[snakeToCamel(k)] = snakeToCamelDeep(v);
    return out;
  }
  return value;
}

/** Plain Levenshtein distance — small inputs (field names), no need for anything fancier. */
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[a.length]![b.length]!;
}

function nearestSibling(key: string, candidates: string[]): string | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => (levenshtein(key, c) < levenshtein(key, best) ? c : best));
}

/** The known field list for the section a zod issue's path points into, if any. */
function fieldsFor(path: PropertyKey[]): string[] | undefined {
  if (path.length === 1 && typeof path[0] === 'string') return SECTION_FIELDS[path[0]];
  if (path.length === 2 && path[0] === 'models') return PHASE_POLICY_FIELDS;
  return undefined;
}

/** Renders a zod issue as one or more human-readable problems, keys in snake_case. */
function formatIssue(issue: { code: string; path: PropertyKey[]; message: string; keys?: string[] }): PolicyProblem[] {
  const snakePath = issue.path.map(p => (typeof p === 'string' ? camelToSnake(p) : String(p)));

  if (issue.code === 'invalid_key' && issue.path[0] === 'models') {
    const key = String(issue.path[issue.path.length - 1]);
    return [{
      message: `models.${key} names an unknown phase (known: ${PHASE_NAMES.join(', ')})`,
      key: `models.${key}`,
    }];
  }

  if (issue.code === 'unrecognized_keys' && issue.keys) {
    const fields = fieldsFor(issue.path);
    return issue.keys.map(k => {
      const fullKey = [...snakePath, camelToSnake(k)].join('.');
      const suggestion = fields ? nearestSibling(k, fields) : null;
      const hint = suggestion ? ` (did you mean '${[...snakePath, camelToSnake(suggestion)].join('.')}'?)` : '';
      return { message: `${fullKey} is not a recognized field${hint}`, key: fullKey };
    });
  }

  const fullKey = snakePath.join('.');
  return [{ message: fullKey ? `${fullKey}: ${issue.message}` : issue.message, key: fullKey || undefined }];
}

/**
 * Parses `factory.policy.yaml`: malformed YAML, an unknown key inside an
 * implemented section, or a value the resolver cannot use are all fatal and
 * collected together rather than stopping at the first. An unrecognised
 * top-level section or a retired key is a warning; resolution continues.
 */
export function parsePolicyFile(text: string): ParseResult {
  const doc = parseDocument(text, { merge: true });
  if (doc.errors.length > 0) {
    return { ok: false, errors: doc.errors.map(e => ({ message: e.message })), warnings: [] };
  }

  const parsedRaw = doc.toJS() ?? {};
  if (!isPlainObject(parsedRaw)) {
    return {
      ok: false,
      warnings: [],
      errors: [{ message: `factory.policy.yaml must be a mapping at the top level, got ${Array.isArray(parsedRaw) ? 'a list' : typeof parsedRaw}` }],
    };
  }

  const warnings: PolicyProblem[] = [];
  const working: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(parsedRaw)) {
    if (!(KNOWN_TOP_SECTIONS as readonly string[]).includes(rawKey)) {
      warnings.push({
        message: `${rawKey} is not a section the factory implements yet; ignored`,
        key: rawKey,
      });
      continue;
    }
    working[rawKey] = value;
  }

  for (const retired of RETIRED_KEYS) {
    const section = working[retired.section];
    if (isPlainObject(section) && retired.key in section) {
      warnings.push({ message: retired.message, key: `${retired.section}.${retired.key}` });
      const rest = { ...section };
      delete rest[retired.key];
      working[retired.section] = rest;
    }
  }

  const camelCased = snakeToCamelDeep(working);
  const result = policyOverrideSchema.safeParse(camelCased);
  if (result.success) {
    return { ok: true, override: result.data, warnings };
  }
  return { ok: false, errors: result.error.issues.flatMap(formatIssue), warnings };
}
