---
status: accepted
date: 2026-08-27
---
# Status is a code-owned state machine; every transition names its owner

Ticket status is workflow state only. The S1 set is `backlog → todo → planning → ready → building → review → done`, plus `cancelled`; `needs_human` is added with the controller (S5). The blueprint's names changed (`draft`→`backlog`/`todo`/`planning`, `running`→`building`, `ready_for_review`→`review`); its authority rules did not: humans approve, re-arm, ship and cancel; the controller (later) owns `ready→building` and `building→review`. The allowed transitions live in one table (`transitions.ts`) with an owner per edge; the API validates against it and the kanban derives droppable columns and refusal text from it, so controller-owned edges become refusals in S5 without UI changes.

S1 transitions (all human): `backlog/todo/planning` move freely among themselves; `todo→ready` and `planning→ready` (approve; requires an app, a description, and a ticket design unless the ticket is flagged simple); `ready→planning` (unapprove); `ready→building` (start by hand); `building→review`; `building→ready` (stop); `review→done` (ship); anything but `done` → `cancelled`; `cancelled→backlog` (restore). Review fix-ups stay in `review`.

## Consequences

- Editing a ticket's fields never changes its status.
- Blocked is derived (an open blocker), never a status; `cancelled` blockers do not block.
- The ready frontier in S1 is `ready ∧ no open blocker`; the lease/concurrency clauses arrive in S5.
- Every mutation writes an `event` row: entity, actor (`human` | `agent`), kind, prior, new, timestamp. No auth in S1; the API binds to localhost and trusts a declared actor.
