# 04: Lifecycle — transition table, intent endpoints, drag-and-drop

**What to build:** Status moves only through named transitions. The transition table lives in `shared` with `{from, to, name, owner, since, guard}` per edge and is the single source both the API and the board read. `(from, name)` identifies exactly one edge. S1 edges (ADR-0003), 26 of them, all `human`/`S1`:

| from | name | to |
| --- | --- | --- |
| `backlog`, `planning` | `pick` | `todo` |
| `backlog`, `todo` | `plan` | `planning` |
| `todo`, `planning` | `shelve` | `backlog` |
| `todo`, `planning` | `approve` *(guarded)* | `ready` |
| `ready` | `unapprove` | `planning` |
| `ready` | `start` | `building` (owner controller from S5) |
| `building` | `stop` | `ready` |
| `building` | `submit` | `review` (owner controller from S5) |
| `review` | `ship` | `done` |
| `backlog`, `todo`, `planning`, `ready`, `building` | `close` | `done` |
| every status but `cancelled` | `cancel` | `cancelled` |
| `cancelled` | `reopen` | `backlog` |

No `review → building`. `close` skips `review` because the verb there is `ship`; it is unguarded — it records work that turned out to be done as a side effect of another ticket. `reopen`, not `restore`: `POST /tickets/:key/restore` already means un-trash.

**The approve guard** is one pure function in `shared` over the ticket, returning the *missing* items: an **app**, and a **design** (non-whitespace) unless `simple`. Not a description. It gates three places — the `approve` edge, creation into `ready`/`building`/`review`, and a `PATCH` at those statuses that would break it.

On the board I drag a card to another column: the drop performs that transition optimistically; a refused move (`409 {owner, hint}`) rolls the card back and shows the hint inline at the target column per DESIGN.md Components (120 ms fade in, clears on the next drag/click or after 4 s). Columns with no edge from the dragged card's status visibly refuse the drop. Drop position within a column means nothing — no claim order in S1, so no insertion indicator. A `simple` toggle lives on the Ticket view. Approve/unapprove/etc. are also buttons in the Ticket view's state tile, derived from the same table.

**Blocked by:** 03 (Tickets with keys, kanban home, ticket view)

**Status:** done

- [x] `POST /tickets/:key/:name` for every edge in the table, no body, actor from the header, registered after `restore` so the un-trash route is never shadowed
- [x] Name not in the table → `404`; name in the table but no edge from this status (including a move to the status it is already in) → `409` with `owner` and a sentence generated from the status pair; guard failure → `409` naming the missing item
- [x] Creation runs the guard for `ready`/`building`/`review`, and refuses `done`/`cancelled` outright — `422` on `path: ['status']`
- [x] `PATCH` at `ready`/`building`/`review` refuses an edit that would break the guard (clearing the app; `simple` true→false with no design) — `422` naming the field and saying to unapprove first
- [x] Every transition writes a `transitioned` event: `prior: {status}`, `new: {status, transition}`
- [x] Table-driven test asserts the S1 edge list equals ADR-0003 exactly (an extra or missing edge fails), holding its own transcription in a different shape so it is not comparing the table to itself
- [x] API tests cover every edge accepted, a representative set refused, the approve guard for each condition, `simple` bypass, guarded creation, and the guard-breaking `PATCH`
- [x] Kanban drag-and-drop (pragmatic-drag-and-drop, whole card, no grip) with optimistic update, rollback on 409, inline refusal text, and non-droppable columns indicated by positive marking on the legal ones (never opacity)
- [x] `useTransition` alongside `useWrite`: cancel in-flight ticket queries, snapshot, patch both `['tickets', …]` and `['ticket', key]`, restore on error, invalidate on settle — used by the board *and* the state tile
- [x] Ticket view state tile: transition buttons from the table (`approve` shown even when its guard will refuse), `cancel` + `trash` in a separated group, `simple` toggle, refusals in the existing `gf-refusal` line
- [x] History renders a transition as `approved · planning → ready`
- [x] Browser smoke: drag `backlog→todo` succeeds; drag `review→building` is refused with the hint and snaps back; approve a non-`simple` ticket with no design and see the named refusal; flag it `simple` and see it land in `ready`
