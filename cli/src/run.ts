/**
 * `goblin` is a thin JSON-in/JSON-out client of the API (ADR-0004), never a
 * second write path: every command is one request, and the output is the
 * response body verbatim. Handlers take an injected `fetch` so tests drive
 * them against the in-process Hono app rather than a socket.
 *
 * Errors go to stderr as `application/problem+json` — the API's own body when
 * it gave one, and the same shape made here when it did not — so stdout is
 * either JSON or empty and a caller never has to tell prose from data.
 */
import { ACTOR_HEADER, ActorSchema, DEFAULT_ACTOR, type Actor } from '@goblin/shared';
import { UsageError, parseArgs, type Io, type Value } from './args';
import { GLOBAL_FLAGS, findCommand, findNoun, type Api, type Command, type Noun, type Outcome } from './commands';
import { commandHelp, nounHelp, rootHelp } from './help';

export type GoblinFetch = (path: string, init?: RequestInit) => Promise<Response>;

export interface GoblinDeps {
  fetch: GoblinFetch;
  env?: Record<string, string | undefined>;
  io?: Partial<Io>;
}

export interface GoblinResult {
  code: number;
  /** What the command produced; empty whenever the command failed. */
  out: string;
  /** problem+json, or empty. */
  err: string;
}

/** `1` the API refused, `2` the invocation was wrong, `3` there was nothing at the other end. */
export const EXIT = { ok: 0, problem: 1, usage: 2, unreachable: 3 } as const;

/** The API answered nothing at all, so there is no problem+json to relay and the CLI makes one. */
class UnreachableError extends Error {}

const DEFAULT_IO: Io = {
  readFile: (path) => Bun.file(path).text(),
  readStdin: () => Bun.stdin.text(),
};

/** The one shape stderr ever carries, whoever noticed the failure (RFC 9457, as ADR-0004 uses it). */
const problem = (status: number, title: string, detail: string, hint?: string) =>
  JSON.stringify({ type: 'about:blank', title, status, detail, ...(hint === undefined ? {} : { hint }) });

export async function runGoblin(argv: string[], deps: GoblinDeps): Promise<GoblinResult> {
  const io = { ...DEFAULT_IO, ...deps.io };
  const help = (out: string) => ({ code: EXIT.ok, out, err: '' });
  try {
    // globals may lead (`goblin --actor agent ticket …`); from the noun on, the tokens are the command's
    const noun_at = splitLeading(argv);
    const lead = await parseArgs(argv.slice(0, noun_at), { flags: GLOBAL_FLAGS }, io);
    const tokens = argv.slice(noun_at);

    const noun = findNoun(tokens[0]);
    if (!noun) {
      if (lead.globals.help) return help(rootHelp());
      if (tokens.length === 0) throw new UsageError('goblin needs a noun', 'try `goblin --help`');
      throw new UsageError(`there is nothing called '${tokens[0]}'`, 'try `goblin --help`');
    }

    const rest = tokens.slice(1);
    const found = findCommand(noun, rest);
    // no verb matched, so nothing here can be a flag's value and asking for help is unambiguous
    if (!found && (lead.globals.help || rest.includes('--help'))) return help(nounHelp(noun));

    const command = found?.command ?? fallback(noun, rest);
    const args = await parseArgs(found?.rest ?? rest, { ...command, flags: [...(command.flags ?? []), ...GLOBAL_FLAGS] }, io);
    if (args.globals.help || lead.globals.help) return help(commandHelp(noun, command));

    const actor = resolveActor(args.globals.actor ?? lead.globals.actor ?? (deps.env ?? process.env).GF_ACTOR);
    return await report(await command.run({ args, api: client(deps.fetch, actor), io }));
  } catch (error) {
    if (error instanceof UsageError) return { code: EXIT.usage, out: '', err: usage(error.message, error.hint) };
    if (error instanceof UnreachableError)
      return { code: EXIT.unreachable, out: '', err: problem(503, 'Service Unavailable', error.message, 'is `bun dev` running? GF_URL points elsewhere') };
    // a driver error out of `backup`, a body that was not JSON: whatever went wrong, it leaves in the one shape
    return { code: EXIT.problem, out: '', err: problem(500, 'Internal Error', error instanceof Error ? error.message : String(error)) };
  }
}

/**
 * Where the noun starts. Globals written before it may take a value, so the
 * split has to know which ones do; an unknown flag is left in the leading
 * slice, where the parser owns the refusal like any other.
 */
function splitLeading(argv: string[]): number {
  let i = 0;
  while (argv[i]?.startsWith('--')) {
    const written = argv[i] as string;
    const flag = GLOBAL_FLAGS.find((f) => f.name === written.slice(2).split('=')[0]);
    i += flag && flag.kind !== 'boolean' && !written.includes('=') ? 2 : 1;
  }
  return i;
}

/** The verb `goblin <noun>` means on its own, or the refusal that it means nothing. */
function fallback(noun: Noun, tokens: string[]): Command {
  const command = noun.commands.find((c) => c.verb === noun.fallback);
  if (command) return command;
  const written = tokens[0];
  throw new UsageError(written === undefined ? `goblin ${noun.name} needs a verb` : `${noun.name} has no verb '${written}'`, `try \`goblin ${noun.name} --help\``);
}

/** `--actor`, then `GF_ACTOR`, then the default — the flag wins, so a human can approve in a shell an agent set up. */
function resolveActor(written: Value | undefined): Actor {
  const parsed = ActorSchema.safeParse(written ?? DEFAULT_ACTOR);
  if (!parsed.success) throw new UsageError(`'${written}' is not an actor`, 'human or agent');
  return parsed.data;
}

const usage = (detail: string, hint?: string) => problem(400, 'Usage', detail, hint);

/** The API body, verbatim: on stdout when it answered, on stderr when it refused. */
async function report(outcome: Outcome): Promise<GoblinResult> {
  if (!(outcome instanceof Response)) return { code: EXIT.ok, out: outcome.text, err: '' };
  const body = await outcome.text();
  if (outcome.ok) return { code: EXIT.ok, out: body, err: '' };
  // anything that is not problem+json (a proxy's HTML, a bare 500) is wrapped into the shape callers parse
  const shaped = outcome.headers.get('content-type')?.includes('application/problem+json');
  return { code: EXIT.problem, out: '', err: shaped ? body : problem(outcome.status, outcome.statusText || 'Error', body.trim().slice(0, 500)) };
}

/** Every request carries the actor (CONTEXT.md "Actor"); a failure to reach the API at all is a different exit code, so it is caught here. */
function client(fetch: GoblinFetch, actor: Actor): Api {
  const send = async (method: string, path: string, body?: unknown): Promise<Response> => {
    try {
      return await fetch(path, {
        method,
        headers: { [ACTOR_HEADER]: actor, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      throw new UnreachableError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return {
    get: (path) => send('GET', path),
    post: (path, body) => send('POST', path, body),
    patch: (path, body) => send('PATCH', path, body),
    del: (path) => send('DELETE', path),
  };
}
