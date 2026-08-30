---
status: accepted
date: 2026-08-27
---
# S1 non-goals

S1 is done when a fresh Subway Reader MVP project is created in the GUI, an agent-assisted planning conversation (a Claude Code skill over the `goblin` CLI) produces approved tickets with dependencies through the API, tickets can be dragged between statuses, and the ready frontier is correct on screen. Everything below is excluded so the slice cannot grow; each returns only when a later slice's exit criterion needs it.

- real-time sync, SSE, sync engines, multi-user, auth
- comments, mentions, notifications
- saved views beyond URL-parameter filters (app, project, status set, title text)
- custom statuses; the `needs_human` status (S5)
- labels, milestones, priority, claim order (S5)
- scope, lane, acceptance criteria, budget fields (S2 input snapshot)
- design revisions, shas, repository access of any kind; stored HTML renderings
- images in descriptions and designs — pasting, storing or sizing them (`docs/tickets/later/images-in-designs.md`: where the bytes live and what a width means in markdown are both unanswered)
- anything that displays runs, evidence, leases or costs
- import/export, including the legacy `research/subway-reader/TICKETS-v0.md`
- light mode; phone-specific features beyond the responsive (mobile-first) layout
- Cloudflare or any deployment; S1 runs on the laptop
- a planning feature inside the tracker

## In S1, for the record

App, Project, Ticket (with description, design, `simple` flag), TicketDependency, `event` log, the eight-status transition table, Hono + zod API, `goblin` CLI, and the GUI: Kanban (home, with drag-and-drop and filters), Ticket, Project, App views, Linear-style markdown editor (TipTap), Project dependency graph (dagre layout, hover popover, click to open).
