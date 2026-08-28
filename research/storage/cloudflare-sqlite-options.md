# SQLite access layer: local now, Cloudflare later

Researched 2026-08-27. Context: solo-dev ticket tracker, S1 = one Node/Bun process (Hono + zod) + SQLite file. Goal: pick the local driver/ORM so a later Cloudflare move is a driver swap, not a rewrite.

## 1. Durable Objects (DO) SQLite-backed storage

- API: `ctx.storage.sql.exec(query, ...bindings)` is **synchronous**, returns a `SqlStorageCursor` (`toArray()`, `one()`, `raw()`, `next()`, `columnNames`, `rowsRead/rowsWritten`). Consume cursors before the next `await`. [sqlite-storage-api](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- Transactions: `storage.transactionSync(cb)` (cb must be sync); writes with no intervening `await` are coalesced into one implicit atomic transaction; output gates hold responses until writes are durable. [rules-of-durable-objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- Single-writer: each DO is a single-threaded, globally unique instance; requests are serialized, so no write contention by construction. One tracker = one DO (`idFromName("tracker")`).
- Limits (GA 2025-04-07): **10 GB per DO**; 100 KB max statement; 100 bound params/query; 2 MB max string/BLOB/row; 100 columns/table; 30 s CPU/request (configurable to 5 min); free plan 5 GB/account. [limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [changelog](https://developers.cloudflare.com/changelog/post/2025-04-07-sqlite-in-durable-objects-ga/)
- Extensions: FTS5 (incl. fts5vocab), JSON functions; `PRAGMA optimize` supported.
- PITR: `getCurrentBookmark()`, `getBookmarkForTime(ts)` (any point in last **30 days**), `onNextSessionRestoreBookmark(b)`. No managed export; you write your own dump (e.g. alarm -> R2). [access-storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)
- Pricing (Paid $5/mo): 25 B rows read/mo incl. then $0.001/M; 50 M rows written/mo incl. then $1.00/M; 5 GB-month storage incl. then $0.20/GB-mo; requests 1 M incl. + $0.15/M; duration 400k GB-s incl. Free: 5 M reads/day, 100k writes/day. Storage billing started 2026-01-07. [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [billing changelog](https://developers.cloudflare.com/changelog/post/2025-12-12-durable-objects-sqlite-storage-billing/)
- Location: created near first request; does not move afterwards (relocation "planned"); `locationHint`/jurisdiction available. [data-location](https://developers.cloudflare.com/durable-objects/reference/data-location/)
- Hono inside a DO: yes. A DO class has a `fetch(request)`; you can `return app.fetch(request, this.env, this.ctx)` from it and have the outer Worker forward everything with `stub.fetch(c.req.raw)`. Hono's official example instead keeps Hono in the Worker and calls DO methods via RPC. [hono example](https://hono.dev/examples/cloudflare-durable-objects), [hono#3206](https://github.com/honojs/hono/issues/3206). Either works; the "whole app in the DO" shape is closest to S1.
- Gotchas: in-memory state is lost on eviction; no HTTP API/dashboard/query console (you build tooling yourself); migrations must run in `blockConcurrencyWhile` in the constructor; KV-backend namespaces cannot be converted in place.

## 2. D1

- Limits (Paid): **10 GB/db** (500 MB free); 1 TB/account; 100 KB statement; 100 bound params; 2 MB row; 100 columns; 30 s query; 1,000 queries per Worker invocation (50 free). [limits](https://developers.cloudflare.com/d1/platform/limits/)
- Consistency: one primary (single-threaded, sequential) + async read replicas in 6 regions when enabled. Without the Sessions API reads may be stale; `withSession("first-primary")` or bookmarks give sequential consistency. [read-replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)
- Transactions: **no interactive `BEGIN/COMMIT`**; D1 is auto-commit. `batch([...])` is the transaction unit (all-or-nothing, sequential). Drizzle's `db.transaction` on D1 is not a real interactive transaction; use `db.batch`. [d1-database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- Backups: Time Travel restores to any point in 30 days (Paid) / 7 days (Free); in-place, destructive; export to R2 for longer retention. [time-travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- Extensions: FTS5, JSON1, math; PRAGMAs apply only to the current transaction. [sql-statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
- Drizzle: `drizzle-orm/d1`, async only, migrations via `wrangler d1 migrations apply` on drizzle-kit-generated SQL. [drizzle d1](https://orm.drizzle.team/docs/connect-cloudflare-d1)
- D1 vs DO (Cloudflare's own framing): D1 = network database, "batteries included" (HTTP API, dashboard, migrations, insights, Time Travel); DO SQLite = zero-latency colocated storage, lower level, build your own tooling. Query pricing and limits intended to be identical. Cloudflare recommends SQLite for all new DO namespaces. [access-storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/), [storage-options](https://developers.cloudflare.com/workers/platform/storage-options/)

## 3. Drizzle ORM portability

- Local drivers: `drizzle-orm/better-sqlite3` (sync + async), `drizzle-orm/bun-sqlite` (sync + async), `drizzle-orm/node-sqlite`, `drizzle-orm/libsql` (async; local file or Turso). [get-started-sqlite](https://orm.drizzle.team/docs/get-started-sqlite), [bun-sqlite](https://orm.drizzle.team/docs/connect-bun-sqlite)
- Cloudflare drivers: `drizzle-orm/durable-sqlite` (+ `/migrator`, run in `blockConcurrencyWhile`; wrangler `[[rules]]` to import `.sql`), `drizzle-orm/d1`. [drizzle DO](https://orm.drizzle.team/docs/connect-cloudflare-do)
- Query builder and schema (`sqliteTable`, `sql` tag, relations) are identical across all of these; `drizzle-kit generate` produces the same SQL migration files. The only thing that changes is `drizzle(client)` and how migrations are applied (`migrate()` locally and in DO; `wrangler d1 migrations` for D1).
- Sync vs async: if S1 code uses `.all()/.get()/.run()` sync forms, you cannot move to D1 or libsql (async). **Write everything `await`-style from day one**; it works on every driver including bun:sqlite/better-sqlite3.
- Known DO-driver bugs: [#4322](https://github.com/drizzle-team/drizzle-orm/issues/4322) `db.transaction` on durable-sqlite does not await the callback (open as of research); [#4586](https://github.com/drizzle-team/drizzle-orm/issues/4586) 0.44.0 broke DO entirely (closed). Treat `db.transaction` as untrusted on CF; keep write units small and rely on DO's implicit atomicity or `storage.transactionSync`.
- Dialect gotchas: `RETURNING`, JSON1 and FTS5 work everywhere; WAL/`PRAGMA journal_mode`/`busy_timeout`/`synchronous` are local-only (meaningless on CF; keep them in the local driver setup, not in migrations); D1 PRAGMAs are per-transaction; `ATTACH`, `VACUUM`, multi-db and 100-column/2 MB-row/100-param ceilings are CF-only constraints. Avoid `drizzle-kit push` against CF; use generated SQL files. libsql adds extra `ALTER` forms not in vanilla SQLite; do not rely on them.

## 4. Alternatives

- **libsql / Turso embedded replicas**: local file for reads, writes go to a remote primary over `syncUrl`; needs a filesystem (not Workers). Good if you want local-first + cloud sync without Cloudflare; adds a Turso dependency and a second (async-only) driver. [turso docs](https://docs.turso.tech/features/embedded-replicas/introduction)
- **Litestream v0.5**: sidecar process streaming the local SQLite WAL to S3/R2/B2/GCS/SFTP/file; point-in-time restore; VFS read replicas in 0.5. Zero code change; pairs with the VM option. [litestream](https://litestream.io/), [guides](https://litestream.io/guides/)
- **Small VM (Fly / Hetzner)**: run the S1 process unchanged with a SQLite file + Litestream to R2. Fly shared-cpu-1x ~$2-6/mo + $0.15/GB volume; Hetzner CX22 ~EUR 4-5/mo. No driver swap, no async-only constraint, full SQLite (any PRAGMA, ATTACH, unlimited params). Cost: you own the box/uptime; single region. This is the cheapest "later" path if Cloudflare-specific features (edge, Workers AI, zero ops) are not the draw.

## 5. Recommendation

- **Driver now**: `bun:sqlite` via `drizzle-orm/bun-sqlite` if S1 runs on Bun, else `better-sqlite3`. Both are sync-capable and fast; use them through Drizzle's async API only.
- **ORM**: Drizzle, schema in TS, `drizzle-kit generate` SQL migrations checked in; apply with `migrate()` locally. The same files apply in a DO (`durable-sqlite/migrator`) or via `wrangler d1 migrations`.
- **Target on CF**: one SQLite-backed Durable Object hosting the whole Hono app (`app.fetch` from `DO.fetch`), not D1. Reasons: same single-writer/embedded shape as S1, synchronous zero-latency SQL, 10 GB is far above a personal tracker, PITR 30 days, and no read-replica staleness. Pick D1 only if you want the dashboard/HTTP API/Time Travel tooling more than colocation.
- **Isolate the seam**: one `db.ts` exporting `makeDb(client)`; all SQL through Drizzle; no driver-specific imports elsewhere; local PRAGMAs (`journal_mode=WAL`, `busy_timeout`, `foreign_keys=ON`) set in the local factory only.
- **Rules to keep the swap cheap**: always `await`; no `db.transaction` for correctness-critical multi-statement writes (use small sequential writes, or a repo-level `withTx` that maps to `transactionSync`/`batch` per platform); keep rows < 2 MB (store attachments outside the DB, e.g. R2/filesystem), tables <= 100 columns, queries <= 100 bound params (chunk `IN (...)` lists), statements < 100 KB; no `ATTACH`, no multi-DB, no `VACUUM` in app code; FTS5/JSON1/`RETURNING` are fine; ids as text (ULID/UUID) or integer PK, both portable.
- **Backups locally**: Litestream to R2 (or plain `sqlite3 .backup` cron) so S1 already has PITR-equivalent before any cloud move.
