export interface LabelsDefinition<L extends string> {
  /** `'open'`: any well-formed name, a label created by first use. A list: only these names, written as `normalise` writes them. */
  readonly vocabulary: 'open' | readonly [L, ...L[]];
  /** Most labels one subject may carry. Absent means no limit. */
  readonly limit?: number;
}

export class LabelsDefinitionError extends Error {}

/** A refusal is a whole sentence, fit to stand alone as a problem's `detail`. */
export type Judged<L extends string> = { readonly ok: true; readonly labels: readonly L[] } | { readonly ok: false; readonly refusal: string };

/**
 * Members are closures over the definition, so `labels.normalise` can be
 * passed as a callback.
 */
export interface Labels<L extends string> {
  readonly vocabulary: 'open' | readonly [L, ...L[]];
  readonly limit: number | undefined;
  /** Trimmed and lower-cased; `:` is just part of the name. Says nothing about whether the name is allowed: `judge` does. */
  normalise(name: string): string;
  /**
   * A whole proposed set, as a subject would carry it after the write. Ok
   * with the names normalised and duplicates collapsed to the first, in the
   * order proposed; refused on the first name that is blank, not one word,
   * or outside a fixed vocabulary, then on the limit.
   */
  judge(proposed: readonly string[]): Judged<L>;
  /** Any-of: does an item carrying `carried` have any of `asked`? An empty ask matches everything. */
  matches(carried: readonly string[], asked: readonly string[]): boolean;
}

export type LabelOf<T extends Labels<string>> = T extends Labels<infer L> ? L : never;

const normalise = (name: string): string => name.trim().toLowerCase();
const allowed = (names: readonly string[]): string =>
  names.length === 1 ? `the only label is ${names[0]}` : `the labels are ${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/** Why a normalised name is not well-formed, or `undefined` when it is. Commas are out because a set of labels is written comma-separated. */
const malformed = (name: string): string | undefined =>
  name === '' ? 'a label cannot be blank' : /[\s,]/.test(name) ? `${name} is not one word: a label has no spaces or commas` : undefined;

/**
 * Builds the labels once, at module load. Throws on a definition the types
 * cannot reject, so a bad Assembly fails its first test rather than a request:
 *
 * - a fixed vocabulary that is empty, names a label twice, or writes one
 *   other than `normalise` would (it could never be matched);
 * - a limit that is not a positive whole number.
 */
export function defineLabels<const L extends string = string>(definition: LabelsDefinition<L>): Labels<L> {
  const { vocabulary, limit } = definition;
  const fixed = vocabulary === 'open' ? undefined : vocabulary;
  const known = new Set<string>(fixed);

  const faults: string[] = [];
  if (fixed) {
    if (fixed.length === 0) faults.push('a fixed vocabulary names no labels');
    for (const [i, name] of fixed.entries()) {
      const fault = malformed(name);
      if (fault !== undefined) faults.push(fault);
      else if (normalise(name) !== name) faults.push(`${name} is written as ${normalise(name)}`);
      else if (fixed.indexOf(name) !== i) faults.push(`${name} is listed twice`);
    }
  }
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) faults.push(`a limit of ${limit} is not a positive whole number`);
  if (faults.length > 0) throw new LabelsDefinitionError(faults.join('; '));

  const judge = (proposed: readonly string[]): Judged<L> => {
    const labels = [...new Set(proposed.map(normalise))];
    for (const label of labels) {
      const fault = malformed(label);
      if (fault !== undefined) return { ok: false, refusal: fault };
    }
    if (fixed) {
      const stranger = labels.find((label) => !known.has(label));
      if (stranger !== undefined) return { ok: false, refusal: `${stranger} is not a label here; ${allowed(fixed)}` };
    }
    if (limit !== undefined && labels.length > limit) return { ok: false, refusal: `${labels.length} labels are over the limit of ${limit}` };
    return { ok: true, labels: labels as L[] };
  };

  const matches = (carried: readonly string[], asked: readonly string[]): boolean => {
    if (asked.length === 0) return true;
    const have = new Set(carried.map(normalise));
    return asked.some((name) => have.has(normalise(name)));
  };

  return { vocabulary, limit, normalise, judge, matches };
}
