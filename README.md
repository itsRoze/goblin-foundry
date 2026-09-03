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
