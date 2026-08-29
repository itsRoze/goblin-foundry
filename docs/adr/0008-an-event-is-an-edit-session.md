---
status: accepted
date: 2026-08-29
---
# An event is an edit session, not a write

Issue 07 makes every text field on a view continuously editable, Linear-style: no edit mode,
no save button, a debounced write while you type. Under the rule as written — one `event` row
per mutation, carrying the full prior and new body — a two-minute design-writing sitting
produces dozens of rows, each holding a whole markdown document. The history tile becomes
unreadable and the `event` table becomes the biggest thing in the database.

An `updated` event is therefore **amended in place** rather than appended when it is the same
entity, the same actor, an overlapping field set, and within five minutes of the last write.
The amended row keeps its original `prior` — so the recoverable text is what you started the
sitting with, not the state one keystroke ago — and advances `at` and `new` to the latest write.
Coalescing lives in the API, so `goblin` and agents inherit it rather than each client
reinventing a batching rule.

Rejected: keeping every write and grouping at render time (the table still grows without
bound, and "the design's history" would mean scrolling a hundred rows); storing only a hash or
length for design bodies (that guts ADR-0005, where the event log *is* the design's version
history); coalescing in the client by sending an explicit `prior` (a client that crashes
mid-session, or a second client, gets it wrong).

## Consequences

- The actor is part of the key, so a human edit never folds into an agent's. A planner
  rewriting a design you just touched stays a distinct row — which is the history that matters
  once the controller is live (S5).
- "Overlapping field set", not identical: retitling and then editing the description within the
  window is one session, because both touch the same row for the same reason.
- Event ids are no longer monotonic with respect to edit recency; the history tile orders by
  `at`, not by `id`.
- Recovering a design means reading `prior` off the session's row — the granularity of undo is
  a sitting, not a keystroke. Keystroke undo is `⌘Z` inside the editor, and it is not durable.
- A future append-only audit requirement (multi-user, S6+) would have to revisit this; in a
  solo factory nothing reads the event log for attestation.
