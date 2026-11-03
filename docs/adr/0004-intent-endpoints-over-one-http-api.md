---
status: accepted
date: 2026-08-27
---
# One typed HTTP API; transitions are intent endpoints, fields are resources

The Hono + zod API is the only write path; the web GUI, the `goblin` CLI and later the agent capability are clients. Status changes are named intent endpoints (`POST /tickets/:key/approve|start|ship|cancel|…`), never a `status` field in `PATCH`; fields (title, description, design, app, project, simple) are ordinary `PATCH` resources; dependencies are `POST/DELETE /dependencies`. This keeps the transition table the single authority and lets agents later get task-scoped intents without generic record mutation. Errors are `application/problem+json`: `422` with zod issues, `409` `{owner, hint}` for refused transitions (the GUI shows `hint` as the refusal message), `404` otherwise. No optimistic concurrency in S1 (single user). Amended 2026-11-02 (GF-79): a field save may name the row version it was judged on and is refused if the row moved; see ADR-0001's GF-79 line.

## Consequences

- The `goblin` CLI is a thin JSON-in/JSON-out wrapper so the planning skill has a reliable tool; it is not a second write path.
- The GUI uses plain fetch with a query cache, optimistic transitions rolled back on `409`, refetch on focus, and a 5 s poll on the board while visible. No SSE, no sync engine.
