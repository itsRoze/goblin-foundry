# 05: Dependencies and the ready frontier

**What to build:** From the Ticket view I can declare "this ticket is blocked by GF-n" (typeahead picker by key or title) and remove it. Any ticket may block any other — no App or Project constraint (ADR-0007) — and only cycles are refused: the insert walks **all** declared edges, whatever their statuses, so reopening a ticket can never resurrect a cycle nobody was asked about; self-dependency is the one-node case. An edge whose blocker is already `done`/`cancelled` is accepted and inert (a true fact about the work; it bites only if the blocker is reopened). An edge touching a Trashed ticket is refused, but existing edges survive a trip through the trash: a trashed blocker stops blocking, restoring it re-blocks.

Every ticket read carries `blocked_by`: the keys of blockers that are open (status not `done`/`cancelled`, not trashed), derived in one joined query for list reads. The single-ticket read also carries `dependencies` — both directions, as `{key, title, status}`. `GET /api/frontier` returns tickets in `ready` with empty `blocked_by`, ordered by `updated_at` ascending (stalest first).

Blockedness never gates a transition (the human is the authority in S1; the frontier is the controller's enforcement point). The one warning is a confirm dialog when `start`ing a blocked ticket — the verb that means "proceeding despite the blocker". On the board, blocked cards in **non-terminal** columns show the ◇ outline glyph and struck-through title (never a colour, never opacity) — the ready frontier is visibly the unstruck cards in `ready`. `done`/`cancelled` cards are never struck as blocked (nowhere left to proceed to). DESIGN.md §6's *frontier row* is a different, not-yet-built component and is **not** this ticket — only the kanban card treatment is.

**Blocked by:** 04 (Lifecycle — transition table, intent endpoints, drag-and-drop)

**Status:** ready-for-agent

- [ ] `dependency(blocker_id, blocked_id, created_at)`, unique pair — in `schema.ts` **and** `ensureSchema` (`api/src/db.ts` keeps its own DDL)
- [ ] `POST /api/tickets/:key/dependencies {blocker}`, `DELETE /api/tickets/:key/dependencies/:blockerKey` (intent hangs off the blocked ticket, ADR-0004); duplicate is idempotent; cycle (incl. self) → `409` problem+json with a one-line hint; either end trashed → refused; done/cancelled blocker accepted
- [ ] cycle walk is iterative `select()`s through the db seam (no raw SQL, ADR-0001), over all edges, statuses ignored
- [ ] events on **both** tickets for add and remove (`dependency_added` / `dependency_removed`, payload naming the other key; `EventKind` grows); `describeTicketEvent` renders "blocked by GF-a" on the blocked side, "blocking GF-b" on the blocker side, and the removals
- [ ] `blocked_by` (keys) on ticket reads via one joined query — no per-row N+1; `/api/trash` tickets skip it; single-ticket read adds `dependencies: {depends_on, blocks}`; `TicketSchema` updated
- [ ] trashing keeps edges — delete the detach-plan comment at `api/src/tickets.ts:202`; trashed blocker doesn't block; cancelling a blocker unblocks; completing unblocks; restoring re-blocks
- [ ] `GET /api/frontier` correct under: no deps, done blocker, cancelled blocker, trashed blocker, open blocker, chain of two; `updated_at` asc
- [ ] transitions never gated; web confirm dialog on `start` of a blocked ticket, only there
- [ ] board: ◇ glyph + strikethrough on blocked cards in non-terminal columns (mirror the `is-cancelled` strike, `web/src/app.css:87`); never colour/opacity; `done`/`cancelled` never struck as blocked
- [ ] ticket view: add/remove UI; picker omits self, existing blockers, trashed; offers done/cancelled de-emphasized; "depends on" chips show *all* declared blockers (satisfied ones in the done style), "blocks" chips likewise
- [ ] browser smoke: add a dependency, see the strikethrough; ship the blocker, see it clear
