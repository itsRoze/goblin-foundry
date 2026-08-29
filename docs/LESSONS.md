# Lessons

Running log of things learned while building the tracker, kept from day one (v0 postmortem §7.12). Newest at the bottom. One entry per lesson: what happened, what we now do instead.

## 2026-08-27 — schema at open, not only via `drizzle-kit push`

ADR-0001 says `drizzle-kit push` locally. That is fine for the one dev database, but every API test opens a fresh temp file and the Playwright suite opens another; shelling out to drizzle-kit per test is slow and flaky under Bun. So the seam (`api/src/db.ts`) also applies the schema idempotently (`CREATE TABLE IF NOT EXISTS` + default settings row) when it opens a database. `db:push` still exists for the dev database. Cost: the schema lives in two places (`schema.ts` and `ensureSchema`) — keep them in step, and revisit when we switch to generated migrations at first deploy.

## 2026-08-27 — `bun run --filter` takes package names, not directory names

`bun run --filter 'web' build` says "No packages matched the filter". The filter matches the `name` field (`@goblin/web`), so root scripts use `--filter '@goblin/web'` and `--filter '*'` for all.

## 2026-08-27 — the old GitHub repo held v0

`itsRoze/goblin-foundry` already existed with the retired v0 codebase. Its history was parked on a `v0` branch before `main` was replaced by S1, so the postmortem still has something to point at.

## 2026-08-27 — `drizzle-kit push` does not speak `bun:sqlite`

drizzle-kit connects with `better-sqlite3` or `@libsql/client`, never the Bun driver, so `@libsql/client` is an `api` devDependency used only by `bun run db:push`. App code still imports nothing but `bun:sqlite` (inside `db.ts`).

## 2026-08-27 — Playwright specs must not look like Bun tests

Bare `bun test` picks up `*.spec.ts` and `*.test.ts` everywhere, so a Playwright file named `shell.spec.ts` fails under Bun with "Playwright Test did not expect test() to be called here". Browser tests are `e2e/*.e2e.ts` (Playwright `testMatch`), and `bun test` from the root stays clean without path filters.

## 2026-08-27 — on the bun-sqlite driver, only the query builder is awaitable

Drizzle's `bun-sqlite` driver types `db.run` / `db.all` / `db.get` as synchronous, so `await db.run(...)` is a no-op and the editor says so (TS 80007). The thenable surface is the query builder (`await db.select()…`, `await db.insert()…`). The seam uses sync `run` for PRAGMAs and DDL only; everywhere else, query-builder calls with `await` — a `pragma_*` table-valued function (`select … from pragma_journal_mode`) gets an awaitable read when a test needs one.

## 2026-08-27 — zod 4 reports unknown keys in `keys`, not `path`

A strict object refusing `archived_at` in a body yields one `unrecognized_keys` issue with `path: []` and `keys: ['archived_at']`. The problem+json layer (`api/src/problems.ts`) fans that out into one issue per key so every 422 issue is addressable by `path`, and the GUI can point at a field.

## 2026-08-27 — entity ids collide across kinds; event queries need both columns

`event.entity_id` alone is ambiguous: project 1 and ticket 1 both exist. Every read of events filters on `(entity_kind, entity_id)`; the index is on that pair. A test that forgot the kind saw a project's events under a ticket.

## 2026-08-27 — keyboard shortcuts race with route loading in browser tests

`page.keyboard.press('e')` right after clicking a link fires before the view that owns the `e` handler has mounted (the entity is still loading). Smoke tests wait for the owning tile to be visible before pressing a key.

## 2026-08-28 — refusing a field in a strict body needs `z.undefined(...).optional()`

`PATCH /api/tickets/:key` must refuse `status` with a message that says why (ADR-0003), not the generic "unknown field" a strict object gives. Declaring `status: z.undefined(message)` makes the key *required* (zod 4 reports `expected nonoptional` when it is absent), so the schema carries `z.undefined(message).optional()`: absent is fine, present is a 422 with the message on `path: ['status']`.

## 2026-08-28 — the browser suite shares one database, so it runs on one worker

`playwright.config.ts` starts one API process over one temp database. With the default worker-per-file that meant `apps-projects.e2e.ts` (which asserts on `group-app-1`) racing another spec creating apps. The suite is `workers: 1`; specs may assume the ids they made, in file order.

## 2026-08-29 — `drizzle-kit push` cannot add a CHECK to a table that already exists

Issue 03 added `description`/`status`/`simple`/`design` to `ticket`, with a CHECK on `status`. SQLite cannot add a constraint with `ALTER TABLE`, so drizzle-kit rebuilds the table — and its copy step is `INSERT INTO __new_ticket (…) SELECT description, … FROM ticket`, naming columns the *old* table does not have: `SQLITE_ERROR: no such column: description`. `db:push` cannot get itself out of this.

The dev database is disposable in S1 (ADR-0001, and it was empty), so the fix was to `DROP TABLE ticket` and let `ensureSchema` recreate it at the next `openDb`; `db:push` then reports "Changes applied" with nothing to do. Dropping a table also drops its `sqlite_sequence` row, which would let ticket numbers be reused (ADR-0002) — check the row count and the sequence before reaching for this, and preserve `sqlite_sequence` if either is non-empty. This is the second cost of "schema in two places"; it is the argument for generated migrations at first deploy.

## 2026-08-29 — a server-backed checkbox is not `page.check()`-able

The `simple` toggle is controlled by the ticket the API answered with, so the click does not flip it until the PATCH lands and the query refetches. Playwright's `locator.check()` clicks once and asserts the state without retrying, so it fails. Browser tests click such a control and then `await expect(…).toBeChecked()`, which polls.

## 2026-08-29 — an intent route `/:key/:name` must be registered last

Hono matches in registration order, so `POST /tickets/:key/:name` registered before `POST /tickets/:key/restore` swallows the un-trash. The transition route goes on at the end of `ticketsRoutes`, after every named route, and `restore` is deliberately not a transition name (`reopen` is the one that brings a `cancelled` ticket back).
