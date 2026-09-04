/**
 * Every command `goblin` answers, as data: one subcommand per API endpoint
 * (ADR-0004), grouped under the noun it acts on. The transition verbs are
 * generated from the shared table, never listed by hand, so an edge added in a
 * later slice is a CLI verb the same day — and `--help` reads its statuses off
 * the same rows.
 */
import { FILTER_PARAMS, TRANSITION_NAMES, TRANSITIONS, destinationOf, parseTicketFilter, serialiseTicketFilter, type TransitionName } from '@goblin/shared';
import { UsageError, article, entityId, readText, type Args, type Flag, type Io, type Operand, type Value } from './args';
import { backupCommand } from './backup';

/** The actor-stamped client. Every handler talks to the API only through this (ADR-0004: the CLI is never a second write path). */
export interface Api {
  get(path: string): Promise<Response>;
  post(path: string, body?: unknown): Promise<Response>;
  patch(path: string, body: unknown): Promise<Response>;
  del(path: string): Promise<Response>;
}

export interface Ctx {
  args: Args;
  api: Api;
  io: Io;
}

/**
 * What a command answers with: the API's own `Response`, whose body is printed
 * verbatim, or text the CLI produced itself — a design's raw markdown, and the
 * one command (`backup`) that is not a client at all.
 */
export type Outcome = Response | { text: string };

export interface Command {
  /** The verb, or a two-word verb (`design set`). */
  verb: string;
  summary: string;
  operands?: Operand[];
  flags?: Flag[];
  run(ctx: Ctx): Promise<Outcome>;
}

export interface Noun {
  name: string;
  summary: string;
  commands: Command[];
  /** The verb `goblin <noun>` means on its own, for the nouns that are really one thing (`frontier`, `settings`, `trash`). */
  fallback?: string;
}

const query = (path: string, params: Record<string, string | undefined>) => {
  const pairs = Object.entries(params).filter((pair): pair is [string, string] => pair[1] !== undefined);
  return pairs.length === 0 ? path : `${path}?${new URLSearchParams(pairs)}`;
};

/** A filter value on the wire: an id, or the literal `null` the list endpoints read as "has none". */
const filter = (value: Value | undefined) => (value === undefined ? undefined : value === null ? 'null' : String(value));

/** Which flag a filter parameter arrived on, so a refusal names what was typed rather than a wire name. */
const FILTER_FLAG: Record<(typeof FILTER_PARAMS)[number], string> = { app_id: 'app', project_id: 'project', status: 'status', q: 'q' };

/**
 * The board's Filter (issue 06), read and written by the one parser in
 * `shared`. The CLI checks it before sending because nothing has left yet: a
 * mistyped status is a usage error here, not a round trip.
 */
function filterQuery(args: Args): string {
  const parsed = parseTicketFilter({
    app_id: filter(args.values.app_id),
    project_id: filter(args.values.project_id),
    status: args.values.status === undefined ? undefined : String(args.values.status),
    q: args.values.q === undefined ? undefined : String(args.values.q),
  });
  if (!parsed.ok) throw new UsageError(parsed.issues.map((i) => `--${FILTER_FLAG[i.path[0] as keyof typeof FILTER_FLAG]}: ${i.message}`).join(' · '));
  const qs = serialiseTicketFilter(parsed.filter);
  return qs === '' ? '' : `?${qs}`;
}

const ARCHIVED: Flag = { name: 'archived', kind: 'boolean', summary: 'include archived ones (hidden by default)' };
const CASCADE: Flag = { name: 'cascade', kind: 'boolean', summary: 'take the things inside it to the trash too' };
const APP_FILTER: Flag = { name: 'app', kind: 'id', field: 'app_id', nullable: true, value: '<app|null>', summary: 'only this app, or `null` for the ones with none' };
const PROJECT_FILTER: Flag = { name: 'project', kind: 'id', field: 'project_id', nullable: true, value: '<project|null>', summary: 'only this project, or `null` for the ones with none' };
const TEXT_FILTER: Flag = { name: 'q', kind: 'string', value: '<text>', summary: 'only the ones whose title or description contains this' };
const STATUS_FILTER: Flag = { name: 'status', kind: 'string', value: '<a,b>', summary: 'only these statuses, comma-separated (default: every one)' };

/** A long field: written inline, read from a file, or piped in. Descriptions and designs are pasted, not typed. */
const TEXT = '<text|@path|->';

/**
 * The flags that belong to no command in particular. They are declared like
 * any other so the one parser reads them, which is what keeps `--title --help`
 * a refusal rather than a silent title.
 */
export const GLOBAL_FLAGS: Flag[] = [
  { name: 'actor', kind: 'string', global: true, value: 'human|agent', summary: 'who is acting; GF_ACTOR sets it too (default human)' },
  { name: 'json', kind: 'boolean', global: true, summary: 'accepted and ignored — the output is always the API body' },
  { name: 'help', kind: 'boolean', global: true, summary: 'usage for whatever comes before it' },
];

const appFields = (creating: boolean): Flag[] => [
  { name: 'name', kind: 'string', required: creating, value: '<name>', summary: 'what it is called' },
  { name: 'repository-url', kind: 'string', nullable: true, value: '<url|null>', summary: 'the git repository it owns' },
  { name: 'default-branch', kind: 'string', nullable: true, value: '<branch|null>', summary: 'only alongside a repository url' },
  { name: 'description', kind: 'text', value: TEXT, summary: 'markdown' },
];

const projectFields = (creating: boolean): Flag[] => [
  { name: 'name', kind: 'string', required: creating, value: '<name>', summary: 'what it is called' },
  { name: 'description', kind: 'text', value: TEXT, summary: 'markdown' },
  { name: 'design', kind: 'text', nullable: true, value: TEXT, summary: 'the project design; `null` clears it' },
  { name: 'app', kind: 'id', field: 'app_id', nullable: true, value: '<app|null>', summary: 'the app it belongs to; `null` detaches it' },
];

const ticketFields = (creating: boolean): Flag[] => [
  { name: 'title', kind: 'string', required: creating, value: '<title>', summary: 'the one thing a ticket must have' },
  { name: 'description', kind: 'text', value: TEXT, summary: 'markdown' },
  // creation is design-less on purpose: writing a design is a second call (`design set`)
  ...(creating
    ? [{ name: 'status', kind: 'string' as const, value: '<status>', summary: 'where it starts (human: backlog; agent: planning, and only planning)' }]
    : [{ name: 'design', kind: 'text' as const, nullable: true, value: TEXT, summary: 'the ticket design; `null` clears it' }]),
  { name: 'simple', kind: 'boolean', summary: 'straightforward enough to be ready with no design (--no-simple undoes it)' },
  { name: 'app', kind: 'id', field: 'app_id', nullable: true, value: '<app|null>', summary: 'the app it belongs to; `null` detaches it' },
  { name: 'project', kind: 'id', field: 'project_id', nullable: true, value: '<project|null>', summary: 'the project it belongs to; its app follows' },
];

/** Where an App or Project lives, and how it is addressed — one answer, so its verbs and its design commands cannot drift apart. */
const entityAt = (kind: 'app' | 'project') => (ctx: Ctx) => `/api/${kind}s/${entityId(ctx.args.operands[0] as string, kind)}`;
const entityOperand = (kind: 'app' | 'project'): Operand[] => [{ name: kind, summary: 'its id, or <slug>-<id> as the GUI writes it' }];

/**
 * Apps and Projects are the same shape here as at the API — id-addressed,
 * archivable, trashable, each with a history — so their verbs are written once
 * and the difference is only which fields a body takes.
 */
function entityCommands(kind: 'app' | 'project', fields: (creating: boolean) => Flag[], listFlags: Flag[]): Command[] {
  const base = `/api/${kind}s`;
  const one = entityAt(kind);
  const operand = entityOperand(kind);
  return [
    { verb: 'list', summary: `every live ${kind}`, flags: listFlags, run: ({ args, api }) => api.get(query(base, listQuery(args))) },
    { verb: 'create', summary: `a new ${kind}`, flags: fields(true), run: ({ args, api }) => api.post(base, args.values) },
    { verb: 'show', summary: `one ${kind}`, operands: operand, run: (ctx) => ctx.api.get(one(ctx)) },
    { verb: 'update', summary: `change ${article(kind)} ${kind}'s fields`, operands: operand, flags: fields(false), run: (ctx) => ctx.api.patch(one(ctx), ctx.args.values) },
    { verb: 'archive', summary: 'out of the way, not gone', operands: operand, run: (ctx) => ctx.api.post(`${one(ctx)}/archive`) },
    { verb: 'unarchive', summary: 'bring it back into the lists', operands: operand, run: (ctx) => ctx.api.post(`${one(ctx)}/unarchive`) },
    {
      verb: 'trash',
      summary: 'a recoverable deletion',
      operands: operand,
      flags: [CASCADE],
      run: (ctx) => ctx.api.del(query(one(ctx), { cascade: ctx.args.values.cascade ? '1' : undefined })),
    },
    { verb: 'restore', summary: 'take it back out of the trash', operands: operand, run: (ctx) => ctx.api.post(`${one(ctx)}/restore`) },
    { verb: 'history', summary: 'every recorded change, newest first', operands: operand, run: (ctx) => ctx.api.get(`${one(ctx)}/events`) },
  ];
}

const listQuery = (args: Args) => ({ archived: args.values.archived ? '1' : undefined, app_id: filter(args.values.app_id) });

/**
 * A Design is a markdown document (ADR-0005), so `get` prints it raw — the one
 * command whose output is not JSON — and `set` takes it the way long text
 * always arrives: inline, from a file, or on stdin.
 */
function designCommands(kind: 'project' | 'ticket', address: (ctx: Ctx) => string, operand: Operand[]): Command[] {
  return [
    {
      verb: 'design get',
      summary: `print the ${kind} design as raw markdown`,
      operands: operand,
      async run(ctx) {
        const res = await ctx.api.get(address(ctx));
        if (!res.ok) return res;
        const body = (await res.json()) as { design: string | null };
        // no design is not a failure; it is a thing nobody has written yet
        return { text: body.design ?? '' };
      },
    },
    {
      verb: 'design set',
      summary: `write the ${kind} design`,
      operands: [...operand, { name: 'markdown', summary: `the design: ${TEXT}` }],
      run: async (ctx) => ctx.api.patch(address(ctx), { design: await readText(ctx.args.operands[operand.length] as string, ctx.io) }),
    },
  ];
}

/** A ticket is addressed by its key, and leniently (`GF-7`, a stale `SR-7`, a bare `7`): the API owns that rule, so the CLI passes it through (ADR-0002). */
const ticketOperand: Operand[] = [{ name: 'ticket', summary: 'its key, e.g. GF-12 (a bare number works too)' }];
const ticketAt = (ctx: Ctx) => `/api/tickets/${encodeURIComponent(ctx.args.operands[0] as string)}`;

/** One verb per edge name in the table, with the statuses it leads out of read off the same rows. */
const transitionCommands = (): Command[] =>
  TRANSITION_NAMES.map((name: TransitionName) => ({
    verb: name,
    summary: `${TRANSITIONS.filter((t) => t.name === name)
      .map((t) => t.from)
      .join(', ')} → ${destinationOf(name)}`,
    operands: ticketOperand,
    run: (ctx: Ctx) => ctx.api.post(`${ticketAt(ctx)}/${name}`),
  }));

const DEPENDENCY_FLAGS: Flag[] = [
  { name: 'blocker', kind: 'string', required: true, value: '<ticket>', summary: 'the ticket that must be done first' },
  { name: 'blocked', kind: 'string', required: true, value: '<ticket>', summary: 'the ticket that has to wait' },
];

/** The edge hangs off the *blocked* ticket: declaring a dependency is something you do to the thing that waits (ADR-0004). */
const blockedAt = (args: Args) => `/api/tickets/${encodeURIComponent(String(args.values.blocked))}/dependencies`;

export const NOUNS: Noun[] = [
  {
    name: 'app',
    summary: 'a product the factory works on; owns one git repository',
    commands: entityCommands('app', appFields, [ARCHIVED]),
  },
  {
    name: 'project',
    summary: 'a body of work, usually inside an app',
    commands: [...entityCommands('project', projectFields, [ARCHIVED, APP_FILTER]), ...designCommands('project', entityAt('project'), entityOperand('project'))],
  },
  {
    name: 'ticket',
    summary: 'a unit of work — or, early on, just an idea',
    commands: [
      {
        verb: 'list',
        summary: 'every live ticket',
        flags: [APP_FILTER, PROJECT_FILTER, STATUS_FILTER, TEXT_FILTER],
        run: ({ args, api }) => api.get(`/api/tickets${filterQuery(args)}`),
      },
      { verb: 'create', summary: 'a new ticket (design-less: write the design with `ticket design set`)', flags: ticketFields(true), run: ({ args, api }) => api.post('/api/tickets', args.values) },
      { verb: 'show', summary: 'one ticket, with the edges on both sides of it', operands: ticketOperand, run: (ctx) => ctx.api.get(ticketAt(ctx)) },
      { verb: 'update', summary: "change a ticket's fields (never its status — that is a verb)", operands: ticketOperand, flags: ticketFields(false), run: (ctx) => ctx.api.patch(ticketAt(ctx), ctx.args.values) },
      { verb: 'trash', summary: 'a recoverable deletion, for a ticket made by mistake', operands: ticketOperand, run: (ctx) => ctx.api.del(ticketAt(ctx)) },
      { verb: 'restore', summary: 'take it back out of the trash', operands: ticketOperand, run: (ctx) => ctx.api.post(`${ticketAt(ctx)}/restore`) },
      { verb: 'history', summary: 'every recorded change, newest first', operands: ticketOperand, run: (ctx) => ctx.api.get(`${ticketAt(ctx)}/events`) },
      ...designCommands('ticket', ticketAt, ticketOperand),
      ...transitionCommands(),
    ],
  },
  {
    name: 'dependency',
    summary: 'a directed "A blocks B" edge between two tickets',
    commands: [
      { verb: 'add', summary: 'declare that one ticket waits on another', flags: DEPENDENCY_FLAGS, run: ({ args, api }) => api.post(blockedAt(args), { blocker: String(args.values.blocker) }) },
      { verb: 'remove', summary: 'withdraw the edge', flags: DEPENDENCY_FLAGS, run: ({ args, api }) => api.del(`${blockedAt(args)}/${encodeURIComponent(String(args.values.blocker))}`) },
    ],
  },
  {
    name: 'frontier',
    summary: 'the ready tickets with nothing in their way, stalest first',
    fallback: 'show',
    // no `--status`: the frontier is `ready` by definition, and the endpoint says so
    commands: [{ verb: 'show', summary: 'the ready frontier', flags: [APP_FILTER, PROJECT_FILTER, TEXT_FILTER], run: ({ args, api }) => api.get(`/api/frontier${filterQuery(args)}`) }],
  },
  {
    name: 'trash',
    summary: 'everything recoverably deleted, most recent first',
    fallback: 'list',
    commands: [{ verb: 'list', summary: 'what is in the trash', run: ({ api }) => api.get('/api/trash') }],
  },
  {
    name: 'settings',
    summary: "the installation's own record",
    fallback: 'show',
    commands: [
      { verb: 'show', summary: 'the settings', run: ({ api }) => api.get('/api/settings') },
      {
        verb: 'set',
        summary: 'change a setting',
        flags: [{ name: 'ticket-prefix', kind: 'string', required: true, value: '<prefix>', summary: 'the prefix in every ticket key (GF in GF-12)' }],
        run: ({ args, api }) => api.patch('/api/settings', args.values),
      },
    ],
  },
  {
    name: 'backup',
    summary: 'a dated copy of the database, taken from the file itself',
    fallback: 'write',
    commands: [
      {
        verb: 'write',
        summary: 'write foundry-<timestamp>.db into a directory that already exists',
        operands: [{ name: 'dir', summary: 'where to put the copy' }],
        run: ({ args }) => backupCommand(args.operands[0] as string),
      },
    ],
  },
];

export const findNoun = (name: string | undefined): Noun | undefined => NOUNS.find((n) => n.name === name);

/**
 * The command these tokens name, longest verb first so `design set` is matched
 * before a hypothetical `design`, and what is left over for it to parse.
 */
export function findCommand(noun: Noun, tokens: string[]): { command: Command; rest: string[] } | undefined {
  const words = (c: Command) => c.verb.split(' ');
  const match = [...noun.commands].sort((a, b) => words(b).length - words(a).length).find((c) => words(c).every((word, i) => tokens[i] === word));
  return match ? { command: match, rest: tokens.slice(words(match).length) } : undefined;
}
