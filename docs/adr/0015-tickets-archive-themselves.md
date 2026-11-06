---
status: accepted
date: 2026-11-05
---
# A finished Ticket archives itself, and Archived is computed, not stored

`done` grows without end and the wide kanban stops being readable. A Ticket that has been `done` or `cancelled` for 30 days now leaves the board on its own. This reverses the glossary's old rule that a Ticket is never archived, which held because App and Project archiving is done by hand and a Ticket had `cancelled` and Trash instead.

The month runs from the later of the Ticket's **finish time** — the latest Transition into the terminal Status it is in now, read from its History — and its last `unarchive`. A Ticket is Archived when it is terminal and that clock is more than 30 days old. Nothing stores it: every read works it out from the event table and the current time.

## Considered options

- **An inactivity clock, as Linear has.** Rejected. An edit or a label change on a finished Ticket would keep it on the board, and the operator asked for a month after finishing.
- **A stored `archived_at` written by a sweep.** Rejected. A sweep needs something to run it on a timer and an Actor to record it under, and only `human` and `agent` exist (ADR-0012). It would also be one more column to keep in step with the Status: a `cancel` or `reopen` would have to clear it in the same batch.
- **Manual archiving as well.** Not now. One way out keeps the rule simple; `unarchive` is the only write.

## Consequences

- There is no `archived` event for a Ticket. History records `unarchived` (with the `archived_at` it undid), and the finish Transition already records when the clock started.
- `GET /api/tickets` leaves archived Tickets out unless the query says `archived=1` or carries `q`. A single read always answers, with `archived_at`. The frontier is `ready` only, so it is unaffected.
- An archived blocker is terminal, so it is inert as before (ADR-0009). The Project graph drops an edge between two archived Tickets, and draws an archived Ticket only while an edge ties it to one still on the board.
- Every list read pays a correlated subquery per Ticket over `event`, which the `event_entity` index serves. If that ever shows, the clock can be denormalised then; the rule does not change.
- A finished Ticket with no recorded finish (written before History) has no clock and is never archived.
