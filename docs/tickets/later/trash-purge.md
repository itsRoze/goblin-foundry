# Later: `goblin trash purge`

Deferred from 02 (2026-08-27) and again from 09 (2026-09-02). Nothing in S1's exit criterion needs it, and it has its own open questions: does purging an App or Project cascade through children still in the Trash; what happens to the dependency edges of a purged Ticket (they survive the Trash today, ADR-0009); and where an event goes when its entity no longer exists. Needs a `POST /api/trash/purge` endpoint (the CLI is never a second write path) and a grill of its own.
