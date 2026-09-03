/**
 * The grammar is `goblin <noun> <verb> [operands] [flags]` — singular noun,
 * then verb. Flags are *declared* per command rather than read ad hoc, so
 * `--help` is generated from the same table the parser walks and an unknown
 * flag is refused instead of quietly dropped.
 */
import { parseSlugId } from '@goblin/shared';

/**
 * A refusal the CLI makes on its own: nothing was sent, so it exits `2`
 * (usage) rather than `1` (the API refused). `hint` is the way out.
 */
export class UsageError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'UsageError';
  }
}

/**
 * `string` is a plain value; `text` is a long field, which may be written
 * inline, read from `@path`, or taken from stdin as `-`; `id` accepts the
 * GUI's `<slug>-<id>` as well as a bare id; `boolean` takes no value and has a
 * `--no-` form.
 */
export type FlagKind = 'string' | 'text' | 'id' | 'boolean';

export interface Flag {
  name: string;
  kind: FlagKind;
  /** A flag about the invocation rather than the request (`--actor`, `--json`, `--help`): it never reaches a body. */
  global?: boolean;
  /** The body or query field this fills; defaults to the name with `-` → `_`. */
  field?: string;
  /** Whether the literal `null` is accepted — the way an update clears a nullable field. */
  nullable?: boolean;
  required?: boolean;
  /** How the value is written in `--help`; booleans have none. */
  value?: string;
  summary: string;
}

export interface Operand {
  name: string;
  summary: string;
}

/** What a flag can carry once it is read. `null` is the cleared field, never "absent". */
export type Value = string | number | boolean | null;

/** Where text that is not on the command line comes from. Injected so tests never touch the filesystem or a terminal. */
export interface Io {
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

export interface Args {
  /** Positional operands, in order, exactly as typed. */
  operands: string[];
  /** The flags that were *given*, keyed by field — a JSON body as it stands. */
  values: Record<string, Value>;
  /** The global flags that were given, keyed by name. Kept out of `values` so a body is only ever fields. */
  globals: Record<string, Value>;
}

const fieldOf = (flag: Flag) => flag.field ?? flag.name.replaceAll('-', '_');

/**
 * A long field is pasted from somewhere rather than typed: `@path` reads a
 * file, `-` reads stdin (so a planner can pipe a design in), and anything else
 * is the text itself.
 */
export async function readText(raw: string, io: Io): Promise<string> {
  if (raw === '-') return io.readStdin();
  if (!raw.startsWith('@')) return raw;
  const path = raw.slice(1);
  try {
    return await io.readFile(path);
  } catch {
    throw new UsageError(`cannot read ${path}`);
  }
}

/** `a project`, `an app` — the nouns are written into sentences, so the sentences have to read. */
export const article = (word: string): string => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/** An App or Project address: `12` or the GUI's `subway-reader-12`. The API only knows the id, so the slug is dropped here. */
export function entityId(raw: string, kind: string): number {
  const parsed = parseSlugId(raw);
  if (!parsed) throw new UsageError(`${raw} is not ${article(kind)} ${kind} address — use the id, or <slug>-<id> as the GUI writes it`);
  return parsed.id;
}

export async function parseArgs(tokens: string[], spec: { operands?: Operand[]; flags?: Flag[] }, io: Io): Promise<Args> {
  const flags = new Map((spec.flags ?? []).map((f) => [f.name, f]));
  const operands: string[] = [];
  const raw = new Map<Flag, string | boolean>();

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    if (!token.startsWith('--')) {
      operands.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    const written = eq === -1 ? token.slice(2) : token.slice(2, eq);
    const negated = written.startsWith('no-') && flags.has(written.slice(3));
    const flag = flags.get(negated ? written.slice(3) : written);
    if (!flag) throw new UsageError(`unknown flag --${written}`);
    const inline = eq === -1 ? undefined : token.slice(eq + 1);

    if (flag.kind === 'boolean') {
      if (inline !== undefined) throw new UsageError(`--${flag.name} is a yes/no flag; write --${flag.name} or --no-${flag.name}`);
      raw.set(flag, !negated);
      continue;
    }
    if (negated) throw new UsageError(`--no-${flag.name} only works on a yes/no flag`);
    // the next flag is never this one's value: `--title --help` is a typo, and reading it as a title would hide that
    const next = tokens[i + 1];
    const value = inline ?? (next === undefined || next.startsWith('--') ? undefined : tokens[++i]);
    if (value === undefined) throw new UsageError(`--${flag.name} needs a value`, `write --${flag.name}=<value> if the value itself begins with --`);
    raw.set(flag, value);
  }

  const globals: Record<string, Value> = {};
  for (const [flag, given] of raw) if (flag.global) globals[flag.name] = typeof given === 'boolean' ? given : given;
  // help answers before anything is checked: you ask for it precisely when you do not know what is required
  if (globals.help) return { operands, values: {}, globals };

  const wanted = spec.operands ?? [];
  if (operands.length < wanted.length) throw new UsageError(`<${(wanted[operands.length] as Operand).name}> is required`);
  if (operands.length > wanted.length) throw new UsageError(`unexpected argument ${operands[wanted.length]}`);
  for (const flag of flags.values()) if (flag.required && !raw.has(flag)) throw new UsageError(`--${flag.name} is required`);

  const values: Record<string, Value> = {};
  for (const [flag, given] of raw) if (!flag.global) values[fieldOf(flag)] = typeof given === 'boolean' ? given : await convert(flag, given, io);
  return { operands, values, globals };
}

async function convert(flag: Flag, given: string, io: Io): Promise<Value> {
  if (flag.nullable && given === 'null') return null;
  if (flag.kind === 'id') return entityId(given, flag.name);
  if (flag.kind === 'text') return readText(given, io);
  return given;
}

/** How a flag is written: `--app <id>`, or a bare `--simple` for a yes/no one. */
export const flagSignature = (flag: Flag): string => (flag.kind === 'boolean' ? `--${flag.name}` : `--${flag.name} ${flag.value ?? '<value>'}`);

/** The same, in a usage line, where what is optional wears brackets. */
export const flagUsage = (flag: Flag): string => (flag.required ? flagSignature(flag) : `[${flagSignature(flag)}]`);
