# Goblin Foundry

A solo software factory. S1 is the tracker: one Bun process, a typed HTTP API over one SQLite file, and a thin web GUI over that API. Domain language in `CONTEXT.md`; decisions in `docs/adr/`; the S1 spec in `docs/specs/S1-tracker-core.md`; house style in `design/DESIGN.md`. How agents work here, and which skill fits what, is in `CLAUDE.md` and `/ask-goblin`.

## Layout

| workspace | what |
|---|---|
| `shared` | zod schemas (and, later, the transition table) imported by all three |
| `api` | Hono + Drizzle over `bun:sqlite`; serves the built GUI; `src/db.ts` is the only module that touches the driver |
| `web` | React + Vite shell, tokens from `design/tokens.css` |
| `cli` | `goblin`, a thin JSON client of the API |
| `e2e` | Playwright smoke suite against the built GUI and a temp database |

## Run

```sh
bun install
bun dev            # builds the GUI in watch mode and serves it from the API on http://127.0.0.1:4747
bun run build      # one-off GUI build
bun test           # in-process API + CLI tests (fresh temp database per test)
bun run test:e2e   # Playwright smoke (builds first; needs `bunx playwright install chromium` once)
                   # set GF_E2E_PORT when another worktree is running its own suite
bun run typecheck
bun run lint       # stylelint (DESIGN.md as rules) + the dead-CSS check
bun run db:push    # drizzle-kit push against the dev database
```

`bun run lint` is where the house style stops depending on review. stylelint holds the parts
of DESIGN.md a machine can hold — colour comes from a token, radius is `0`, no gradients,
shadows or blur, and opacity is never a state mark — and `scripts/unused-css.ts` finds rules
the app no longer uses, which stylelint cannot see because it never reads the JSX.

The database lives at `~/.goblin-foundry/foundry.db` (WAL). Set `GF_DB_PATH` to use another file (tests do), `GF_PORT` to change the port.

## `goblin`

The CLI is a client of the same API the GUI uses, never a second write path (ADR-0004):
one subcommand per endpoint, flags in and the API's own JSON out. Install it once —

```sh
cd cli && bun link   # puts `goblin` in ~/.bun/bin, which must be on your PATH
goblin --help
```

— and read it as **singular noun, then verb**: `goblin ticket create`, `goblin app list`,
`goblin project show 3`, `goblin ticket approve GF-12`. Every noun and every command
answers `--help`; the transition verbs are generated from the shared table, so the
lifecycle is documented by the lifecycle.

| | |
|---|---|
| output | the API body, verbatim, on stdout. `--json` is accepted and ignored. The one exception is `<noun> design get`, which prints raw markdown |
| refusals | `application/problem+json` on stderr, stdout empty. Exit `1` the API refused, `2` the invocation was wrong, `3` nothing answered |
| long text | `--description`, `--design` and `design set` take the text inline, `@path` to read a file, or `-` to read stdin |
| clearing | `null` as the value of a nullable flag on `update` clears the field (`--app null`, `--design null`) |
| actor | `--actor agent`, or `GF_ACTOR`; the flag wins. An agent creates tickets only into `planning` and owns no transition (CONTEXT.md *Actor*) |
| address | tickets by key (`GF-12`, or a bare `12`); apps and projects by id or the GUI's `<slug>-<id>`. No name lookup |
| elsewhere | `GF_URL` points at the API; `goblin backup <dir>` copies the database file itself, from `GF_DB_PATH` or the default |

### A planning session

Hand-written; ticket 12 replaces it with a transcript of the real one.

```sh
$ goblin app create --name 'Subway Reader' --repository-url https://github.com/itsRoze/subway-reader
{"id":1,"name":"Subway Reader",…}
$ goblin project create --name MVP --app subway-reader-1
{"id":1,"app_id":1,"name":"MVP",…}

$ export GF_ACTOR=agent                       # everything below is the planner's hand
$ goblin ticket create --title 'Parse an RSS feed' --project 1
{"key":"GF-1","status":"planning",…}          # an agent creates only into planning
$ goblin ticket design set GF-1 @plan.md      # creation is design-less; the design is a second call
$ goblin ticket create --title 'Render the list' --project 1
{"key":"GF-2","status":"planning",…}
$ goblin dependency add --blocker GF-1 --blocked GF-2
{"key":"GF-2","blocked_by":["GF-1"],…}

$ goblin ticket approve GF-1
{"type":"about:blank","title":"Conflict","status":409,"owner":"human",
 "hint":"approve is the human's move, not the agent's"}    # stderr, exit 1

$ unset GF_ACTOR                              # the human reads the plan and approves it
$ goblin ticket approve GF-1
{"key":"GF-1","status":"ready",…}
$ goblin frontier
[{"key":"GF-1",…}]                            # GF-2 waits, because GF-1 still blocks it
```
