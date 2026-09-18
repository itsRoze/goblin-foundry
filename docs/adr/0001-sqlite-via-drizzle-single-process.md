---
status: accepted
date: 2026-08-27
---
# SQLite through Drizzle, one process, Cloudflare-compatible by construction

S1 runs as one Bun process on the laptop with one SQLite file (`~/.goblin-foundry/foundry.db`, WAL). A later move to Cloudflare is plausible, and Cloudflare's stores are SQLite-flavoured (Durable Object SQLite, D1). So the database is accessed only through Drizzle's **async** API behind a single `db.ts` seam, so that the move is a driver swap (`bun-sqlite` → `durable-sqlite`), not a rewrite. Postgres was rejected: it adds a second service and credentials for a single writer, and closes the Cloudflare path. D1 was rejected as the future target in favour of one SQLite-backed Durable Object hosting the whole Hono app (interactive transactions, colocated, single-writer like S1). Research: `research/storage/cloudflare-sqlite-options.md`.

## Consequences

- Locally, `drizzle-kit push` for speed; switch to `drizzle-kit generate` migrations at first deploy (push does not work against Durable Objects).
- Do not rely on Drizzle `transaction()` for correctness (broken on durable-sqlite); mutations are small sequential statements.
  [ADR-0010](0010-atomic-bulk-ticket-actions.md) supersedes the sequential-statement approach for bulk Ticket actions: they require a verified atomic boundary behind `db.ts`, covering validation, Ticket changes, and history events. Driver-specific transaction support stays inside that seam.
- Avoid: sync driver calls, `ATTACH`, `VACUUM` in app code, `IN` lists over 100 params, rows over 2 MB. One carve-out: on the `bun-sqlite` driver `db.run`/`db.all`/`db.get` are typed synchronous (an `await` there is a no-op), so `db.ts` alone may call `db.run` synchronously for PRAGMAs and DDL; all other code uses the thenable query builder (`await db.select()…`).
- Backups: `goblin backup` (`VACUUM INTO` a dated copy to a synced folder) nightly via launchd; Litestream to R2 when the process leaves the laptop. The second carve-out (2026-09-02): `db.ts` alone may open a read-only connection and run `VACUUM INTO` for `goblin backup`, which only ever runs on the laptop and is not on the request path; the CLI calls that helper rather than importing the driver itself.
- The third carve-out (2026-09-17, with ADR-0010): the API *test harness* may call `db.run` to create SQLite triggers in its own throwaway database, because proving a rollback needs a write that fails after others have run and the fault has to come from the storage boundary rather than from a new application interface. Test files only; nothing under `api/src` gains a call.
- From ticket 13 (2026-09-17) the process is supervised on the laptop by a macOS LaunchAgent (`goblin service`), always against the default database; the nightly backup agent is still to come (`docs/tickets/later/nightly-backup-agent.md`).
- Lease semantics (S5) are defined as an atomic conditional update on one row, which both SQLite and a Durable Object honour.
