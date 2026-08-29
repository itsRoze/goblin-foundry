# 05: Dependencies and the ready frontier

**What to build:** From the Ticket view I can declare "this ticket is blocked by GF-n" (picker by key or title) and remove it. A dependency is refused if it would form a cycle, or if the two tickets belong to different Apps (tickets with no App may only depend on tickets with no App). Every ticket read carries `blocked_by`: its blockers whose status is not `done` or `cancelled`. `GET /frontier` returns tickets in `ready` with an empty `blocked_by`, ordered by `updated_at`. On the board, blocked cards show the outline glyph and struck-through title (never a colour, never opacity) — including in the `ready` column, so the ready frontier is visibly the unstruck cards there. Ticket view shows "depends on" and "blocks" chips.

**Blocked by:** 04 (Lifecycle — transition table, intent endpoints, drag-and-drop)

**Status:** ready-for-agent

- [ ] `POST /dependencies {blocker, blocked}` and `DELETE`; duplicate is idempotent; cycle → `409`; cross-app → `409`; events recorded
- [ ] `blocked_by` on every ticket read; cancelling a blocker unblocks; completing a blocker unblocks; restoring it re-blocks
- [ ] `GET /frontier` correct under: no deps, done blocker, cancelled blocker, open blocker, chain of two
- [ ] Board strikes blocked cards per DESIGN.md §6 frontier row / kanban card rules
- [ ] Ticket view: add/remove dependency UI, "depends on" and "blocks" chips
- [ ] Browser smoke: add a dependency, see the strikethrough; ship the blocker, see it clear
- [ ] (from 02 grill, ADR-0007) drop the cross-app `409` and the app-less rule: any open ticket may block any other; only cycles are refused
