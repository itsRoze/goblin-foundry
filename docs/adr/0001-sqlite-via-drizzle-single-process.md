---
status: accepted
date: 2026-08-27
---
# SQLite through Drizzle, one process, Cloudflare-compatible by construction

S1 runs as one Bun process on the laptop with one SQLite file (`~/.goblin-foundry/foundry.db`, WAL). A later move to Cloudflare is plausible, and Cloudflare's stores are SQLite-flavoured (Durable Object SQLite, D1). So the database is accessed only through Drizzle's **async** API behind a single `db.ts` seam, so that the move is a driver swap (`bun-sqlite` → `durable-sqlite`), not a rewrite. Postgres was rejected: it adds a second service and credentials for a single writer, and closes the Cloudflare path. D1 was rejected as the future target in favour of one SQLite-backed Durable Object hosting the whole Hono app (interactive transactions, colocated, single-writer like S1). Research: `research/storage/cloudflare-sqlite-options.md`.

## Consequences

- Locally, `drizzle-kit push` for speed; switch to `drizzle-kit generate` migrations at first deploy (push does not work against Durable Objects).
- Do not rely on Drizzle `transaction()` for correctness (broken on durable-sqlite); mutations are small sequential statements.
- Avoid: sync driver calls, `ATTACH`, `VACUUM` in app code, `IN` lists over 100 params, rows over 2 MB. One carve-out: on the `bun-sqlite` driver `db.run`/`db.all`/`db.get` are typed synchronous (an `await` there is a no-op), so `db.ts` alone may call `db.run` synchronously for PRAGMAs and DDL; all other code uses the thenable query builder (`await db.select()…`).
- Backups: `goblin backup` (`VACUUM INTO` a dated copy to a synced folder) nightly via launchd; Litestream to R2 when the process leaves the laptop.
- Lease semantics (S5) are defined as an atomic conditional update on one row, which both SQLite and a Durable Object honour.
