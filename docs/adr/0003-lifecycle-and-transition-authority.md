---
status: accepted
date: 2026-08-27
---
# Status is a code-owned state machine; every transition names its owner

Ticket status is workflow state only. The S1 set is `backlog → todo → planning → ready → building → review → done`, plus `cancelled`; `needs_human` is added with the controller (S5). The blueprint's names changed (`draft`→`backlog`/`todo`/`planning`, `running`→`building`, `ready_for_review`→`review`); its authority rules did not: humans approve, re-arm, ship and cancel; the controller (later) owns `ready→building` and `building→review`. The allowed transitions live in one table (`transitions.ts`) with a name and an owner per edge; the API validates against it and the kanban derives droppable columns and refusal text from it, so controller-owned edges become refusals in S5 without UI changes. An edge is addressed by `(current status, name)`, and that pair is unique — no two edges out of one status share a name.

S1 transitions, all human-owned:

| from | name | to |
| --- | --- | --- |
| `backlog`, `planning` | `pick` | `todo` |
| `backlog`, `todo` | `plan` | `planning` |
| `todo`, `planning` | `shelve` | `backlog` |
| `todo`, `planning` | `approve` *(guarded)* | `ready` |
| `ready` | `unapprove` | `planning` |
| `ready` | `start` | `building` |
| `building` | `stop` | `ready` |
| `building` | `submit` | `review` |
| `review` | `ship` | `done` |
| `backlog`, `todo`, `planning`, `ready`, `building` | `close` | `done` |
| every status but `cancelled` | `cancel` | `cancelled` |
| `cancelled` | `reopen` | `backlog` |

`ship` and `close` are the same destination by two roads: `ship` is a PR merged out of `review`, `close` records work that turned out to be done without walking the pipeline (implemented as a side effect of another ticket). `close` is deliberately unguarded — `done` is not the frontier, and recording a fact should not be harder than doing the work. Review fix-ups stay in `review`; there is no `review → building`. `cancel` reaches `cancelled` from `done` too, because marking something done is a mistake you must be able to take back.

**The approve guard** is one pure function over the ticket, shared by every client: it requires an **app**, and a **ticket design** unless the ticket is flagged `simple`. It returns the *missing* items so a refusal can name them. A description is a field, not a gate — for a `simple` ticket the title carries the intent, for any other the design does. A design counts as present only when it is non-whitespace.

## Consequences

- Editing a ticket's fields never changes its status.
- The guard applies wherever a ticket would enter `ready` or beyond, and it stays true afterwards, not only at the instant of crossing:
  - the `approve` transition;
  - **creation** in `ready`, `building` or `review` (a ticket may be created anywhere in the working lifecycle, default `backlog`; creation directly into `done` or `cancelled` is refused — the terminal states are earned, never declared);
  - a **`PATCH`** at `ready`, `building` or `review` that would break the guard — clearing the app, or un-flagging `simple` with no design — is refused, naming the field and saying to `unapprove` first.
- Blocked is derived (an open blocker), never a status; `cancelled` blockers do not block.
- The ready frontier in S1 is `ready ∧ no open blocker`; the lease/concurrency clauses arrive in S5.
- Every mutation writes an `event` row: entity, actor (`human` | `agent`), kind, prior, new, timestamp. A transition's event is kind `transitioned`, carrying the name as well as the status pair, so history reads as decisions (`approved`) and not only as state (`planning → ready`). No auth in S1; the API binds to localhost and trusts a declared actor.
