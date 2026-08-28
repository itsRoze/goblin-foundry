# S1 — Tracker core

Labels: `ready-for-agent`
Inputs: `CONTEXT.md`, `docs/adr/0001–0006`, `design/DESIGN.md`, `design/tokens.css`, `design/rough-v5/` (mockups are rough ideas, not commitments), `BLUEPRINT-v1.md` §1, §3.1, §6.

## Problem Statement

I am building a solo software factory. Before any agent can run a ticket, I need a durable place to hold apps, projects, designs and tickets that I can operate entirely by hand: capture ideas, plan them into vertical-slice tickets with a planning agent, declare what blocks what, approve plans, and see at a glance which tickets are actually ready to build. Linear and GitHub Issues are the wrong shape (v0 postmortem, blueprint §1): they can't express factory authority, and I don't own them. Nothing exists yet — the repository is empty.

## Solution

A single Bun process serving a typed HTTP API (Hono + zod) over one SQLite file, and a thin web GUI over that API. The GUI is a kanban-as-home with drag-and-drop between statuses, plus Ticket, Project and App views with a Linear-style markdown editor for descriptions and designs, a dependency graph per project, and URL-parameter filters. A small `goblin` CLI wraps the API so a Claude Code planning skill can create tickets, designs and dependencies. Status is a code-owned state machine whose transition table names an owner per edge; in S1 every edge is human-owned, and the same table later lets controller-owned columns refuse drags and say why.

**Done when:** a fresh Subway Reader MVP project is created in the GUI; an agent-assisted planning conversation produces approved vertical-slice tickets with dependencies through the API; tickets can be dragged between statuses; the ready frontier is correct on screen.

## User Stories

### Apps and projects
1. As the human, I want to create an App with a name, an optional repository URL, an optional default branch and a description, so that the factory has a home for a product.
2. As the human, I want to rename an App without anything else changing, so that names stay accurate as products evolve.
3. As the human, I want an App view listing its projects and tickets, so that I can see one product at a glance.
4. As the human, I want to create a Project inside an App with a name and description, so that a body of work (e.g. "Subway Reader MVP") has a container.
5. As the human, I want to rename a Project, so that the name stays accurate.
6. As the human, I want a Project view showing its Project Design, its tickets and their statuses, and its dependency graph, so that I can run a planning session against one screen.
7. As the human, I want to write and edit a Project Design as markdown in a Linear-style editor, so that the shape of a project lives with the project.

### Tickets
8. As the human, I want to create a Ticket with just a title, so that capturing an idea costs one action.
9. As the human, I want a Ticket to exist with no App and no Project, so that ideas can be captured before they belong anywhere.
10. As the human, I want to assign or move a Ticket to an App and a Project later, so that ideas graduate into work without losing their key.
11. As the human, I want every Ticket to have a stable key like `GF-12` that never changes or gets reused, so that I can refer to it in conversation, commits and chats.
12. As the human, I want to set the key prefix once for my installation (default `GF`), so that keys read the way I like.
13. As the human, I want to edit a Ticket's title and description (markdown, Linear-style editor) freely, without the edit ever changing its status, so that clarifying a ticket is never a workflow event.
14. As the human, I want to write a Ticket Design as markdown on the ticket, so that the plan for one slice lives with the slice.
15. As the human, I want to flag a Ticket as **simple**, so that a straightforward ticket can become `ready` without a Ticket Design.
16. As the human, I want to see created and updated timestamps on every ticket, so that I know how fresh it is.
17. As the human, I want a Ticket view showing description, design, status, app, project, blockers, blocked tickets and history, so that everything about one ticket is on one screen.
18. As the human, I want cancelling to be the only *workflow* way a ticket leaves the board, with trash (recoverable for 30 days) reserved for things created by accident and archive for apps and projects that are no longer active, so that history is never lost by a workflow action.

### Lifecycle and authority
19. As the human, I want tickets to move through `backlog → todo → planning → ready → building → review → done`, with `cancelled` available from any non-done status, so that the board reflects how work actually flows.
20. As the human, I want to move tickets freely among `backlog`, `todo` and `planning` in either direction, so that early-stage triage is cheap.
21. As the human, I want to approve a ticket (`planning → ready`, or `todo → ready` when it is simple), so that "ready" means I decided it is developable.
22. As the human, I want approval to be refused, with the missing item named, when the ticket has no App, no description, or no Ticket Design (unless simple), so that nothing reaches `ready` half-specified.
23. As the human, I want to unapprove a ticket (`ready → planning`), so that I can reopen a plan.
24. As the human, I want to start a ticket by hand (`ready → building`) and stop it (`building → ready`), so that I can build tickets myself before any controller exists.
25. As the human, I want to move a ticket to `review` and then ship it (`review → done`), so that the loop can be walked end to end by hand.
26. As the human, I want review fix-ups to stay in `review` (no `review → building` edge), so that the board doesn't churn during a review.
27. As the human, I want to cancel any ticket that isn't done and restore a cancelled ticket to `backlog`, so that "not doing" is reversible.
28. As the human, I want every transition to be an explicit, named action in the API (approve, start, ship…), never a status field I can set to anything, so that the state machine is the only authority.
29. As the human, I want a refused move to tell me in one plain sentence who owns it and what would trigger it, so that authority is visible (DESIGN.md §8).
30. As a future controller, I want the transition table to already carry an owner per edge (`ready → building` and `building → review` marked controller-owned from S5), so that flipping ownership later changes no UI code.

### Dependencies and readiness
31. As the human, I want to declare that Ticket A blocks Ticket B from the Ticket view, so that ordering constraints are explicit.
32. As the human, I want a dependency refused if it would create a cycle, so that the graph stays sound; any open ticket may block any other, across apps and projects.
33. As the human, I want to remove a dependency, so that constraints can be corrected.
34. As the human, I want a ticket to count as **blocked** when any blocker is not `done` or `cancelled`, so that cancelled work never holds anything up.
35. As the human, I want blocked to be shown as a derived condition (outline glyph, struck-through title), never as a status or a colour, so that the board matches DESIGN.md §3.
36. As the human, I want the **ready frontier** — tickets in `ready` with no open blocker — to be correct and visible on the board (ready column, blocked cards struck through) and available from the API, so that I know what could start now.
37. As the human, I want a dependency graph on the Project view — diamond nodes coloured by status, dashed edges from open blockers, hover popover with title/status/summary, click opens the ticket — so that I can read a plan's shape and spot bottlenecks.

### Board, filters, navigation
38. As the human, I want the kanban to be the home screen, with one column per status in lifecycle order, so that opening the app shows me the work.
39. As the human, I want to drag a card to another column and have that perform the corresponding transition, rolled back with the refusal message if the API refuses, so that the board is the primary control surface.
40. As the human, I want columns that no edge leads to from the dragged card's status to visibly refuse the drop, so that I learn the state machine by using it.
41. As the human, I want `done` to be visually quiet and `cancelled` hidden unless I filter it in, so that the board shows live work.
42. As the human, I want to filter the board by app, project, status set and title text, with the filter in the URL, so that a bookmarked URL is a saved view.
43. As the human, I want keyboard navigation (`j/k`, `⏎` open, `n` new, `a` approve, `d` deps, `esc` back, `⌘K` anything) with every tile header showing its keys, so that the GUI is keyboard-first (DESIGN.md §8).
44. As the human, I want the layout to work from phone width upward (single column base, tile grid at laptop and wide), with the kanban scrolling inside its tile and drag working on touch, so that I can triage from any device.
45. As the human, I want the GUI to reflect changes made by the CLI or an agent within a few seconds without a reload, so that a planning session in the terminal shows up on the board beside it.

### History and audit
46. As the human, I want every mutation recorded with actor (`human` or `agent`), kind, prior value, new value and timestamp, so that I can see who changed what.
47. As the human, I want a history tile on the Ticket view built from those records, so that a ticket's story is readable without logs.

### CLI and planning
48. As the human, I want a `goblin` CLI that mirrors the API (apps, projects, tickets, designs, dependencies, transitions, frontier) with JSON in/out, so that agents and scripts have a reliable tool.
49. As a planning agent in Claude Code, I want to create tickets, set their designs and add dependencies via `goblin`, so that a planning conversation ends with tickets on the board.
50. As the human, I want agent-created tickets to land in `planning` (never `ready`), so that approval is always mine.
51. As the human, I want `goblin backup` to write a dated copy of the database to a folder I choose, so that the tracker is never the only copy of my memory.
52. As the human, I want to bootstrap Subway Reader on day one by creating the App and MVP Project in the GUI and pasting the existing project design in, so that the first real planning session has something to plan against.

### Errors and validation
53. As an API client, I want validation errors as `422 application/problem+json` with zod issues, refused transitions as `409` with `{owner, hint}`, and unknown keys as `404`, so that every client can show the same message.

## Implementation Decisions

- **Runtime and layout.** Bun, TypeScript end-to-end, Bun workspaces: `api` (Hono + zod, serves the built GUI), `web` (React + Vite), `shared` (zod schemas and the transition table, imported by all three), `cli` (`goblin`). One process; the API binds to localhost. No auth; actor comes from a request header, default `human`. (ADR-0001, 0004)
- **Storage.** SQLite (WAL) at `~/.goblin-foundry/foundry.db` via Drizzle's async API over `bun:sqlite`, isolated behind one database seam module; `drizzle-kit push` locally. No Drizzle transactions relied on for correctness; each mutation is a short sequence of statements. Test databases are temp files or `:memory:`. (ADR-0001, research/storage)
- **Schema.** `app(id serial, name, repository_url?, default_branch? (only with a repository_url), description, archived_at?, trashed_at?, timestamps)`; `project(id serial, app_id?, name, description, design markdown?, archived_at?, trashed_at?, timestamps)`; `ticket(id serial — the number in the key, title, description markdown, design markdown?, status, simple bool, app_id?, project_id?, trashed_at?, timestamps)`; `dependency(blocker_id, blocked_id, created_at)` with a uniqueness constraint; `event(id, entity_kind, entity_id, actor, kind, prior json, new json, at)`; `setting(key, value)` holding the key prefix. No labels, milestones, priority, rank, lane, scope, acceptance, budget, revision or html columns. (ADR-0002, 0005, 0006)
- **Keys.** Ticket key = `prefix + '-' + id`; API routes accept the key or the bare number. Apps/projects addressed by id in the API; GUI URLs are `/apps/<slug>-<id>` and `/projects/<slug>-<id>` where the slug is derived from the name client-side, the id resolves, and a stale slug redirects. Rename is a plain field update. (ADR-0002)
- **Ticket ↔ Project ↔ App.** A ticket in a project has the project's app (`app_id` filled from the project, mismatch `422`, app change clears project). `project.app_id` nullable; moving a project rewrites its tickets' `app_id`. (ADR-0007)
- **Archive and trash.** Apps and projects: `POST …/archive|unarchive` (hidden from lists/pickers by default, `?archived=1` reveals, tickets untouched). Apps, projects, tickets: `DELETE …` trashes (`trashed_at`), `POST …/restore`; children are detached by default, `?cascade=1` trashes them too; `/trash` view lists and restores; `goblin trash purge` hard-deletes (with events) after 30 days — no automatic purge in S1.
- **Transition table** in `shared`: a list of `{from, to, name, owner: 'human' | 'controller', since: 'S1' | 'S5', guard?}`. S1 edges as ADR-0003. The `approve` guard checks app present, description non-empty, design present unless `simple`. The API's transition endpoint and the board's drop logic both derive from this table; nothing else encodes the lifecycle. Refusal `hint` text comes from the table entry.
- **Statuses.** `backlog, todo, planning, ready, building, review, done, cancelled` as a text column with a check constraint; `needs_human` deliberately absent until S5. Colour mapping per DESIGN.md §3 with `backlog/todo/planning` → draft colour, `building` → live, `review` → review. (ADR-0003)
- **Readiness.** Computed on read, never stored: `blocked_by` (open blockers) is attached to every ticket read; `GET /frontier` returns tickets in `ready` with empty `blocked_by`, ordered by `updated_at`. Open blocker = status not in `{done, cancelled}`.
- **Dependencies.** Cycle check on insert (walk blockers of the blocker); no App or Project constraint — any open ticket may block any other (ADR-0007). Removing a dependency writes an event.
- **API surface.** Resources: `apps`, `projects`, `tickets`, `dependencies`, `frontier`, `events` (per entity), `settings`. Field updates via `PATCH`; `status` rejected in `PATCH`. Transitions via `POST /tickets/:key/<name>` where `<name>` is a transition name from the table. Errors per ADR-0004. Every list endpoint accepts the filter params the board uses.
- **Events.** Written in the same request as the mutation, with prior/new limited to the fields that changed; kinds `created | updated | archived | unarchived | trashed | restored | transitioned`. App, Project and Ticket views each have a history tile; the Ticket one reads `GET /tickets/:key/events`.
- **GUI.** React + Vite, TanStack Query (fetch on navigate, optimistic transitions with rollback on 409, refetch on focus, 5 s poll on the board while visible), `@atlaskit/pragmatic-drag-and-drop` for kanban with touch support, TipTap with a markdown serializer for description/design editing (markdown is the only stored form; rendered on read), `@dagrejs/dagre` layout rendered as our own SVG for the graph. Screens: Kanban (home), Ticket, Project, App, plus create forms. Tokens from `design/tokens.css`; house style per DESIGN.md; mobile-first CSS with the tile grid at ≥ laptop widths. DESIGN.md §5 gains a small-layout note and §10 drops "Mobile".
- **CLI.** `goblin` is a thin client: one subcommand per endpoint, JSON output, `--actor agent` flag, plus `goblin backup <dir>` (`VACUUM INTO`). Planning is a Claude Code skill that calls `goblin`; the tracker has no planning feature.
- **Bootstrap.** No seed data and no import. Day one is manual: create App "Subway Reader" (repo URL), Project "MVP", paste `research/subway-reader/PROJECT-DESIGN.md` as the project design, then run the planning skill.

## Testing Decisions

- A good test drives the system through a public seam and asserts observable behaviour — a response, a row visible through another endpoint, a card in another column — never internal function calls or table shapes.
- **Primary seam: the HTTP API, in-process.** Tests call the Hono app's `fetch`/`request` against a fresh temp SQLite database per test, with no server socket. This covers the transition table (every S1 edge accepted, every non-edge refused with the right `409` hint, every guard), readiness and `blocked_by` (including cancelled blockers not blocking), cycle and cross-app refusal, key/prefix behaviour, event recording (actor, prior, new), filters, and problem+json shapes. The `goblin` CLI is tested through the same seam by invoking its command handlers against the in-process app, not by spawning a binary.
- **Secondary seam: the browser, one smoke suite.** A handful of Playwright tests against the built GUI over a temp database: create app → project → ticket, drag a card `todo → planning` and see the status change, drag to a refused column and see the refusal text, approve a ticket and see it appear in the ready column, add a dependency and see the blocked strikethrough. This is the exit criterion made executable; it is not where behaviour is enumerated.
- **The transition table itself** gets one table-driven unit test asserting the S1 edge list matches ADR-0003 exactly, so an accidental edge is a red test.
- No unit tests of React components, query hooks or Drizzle queries in isolation. No mocks of the database.
- Prior art: none in this repo (empty). Style reference: the v0 `inbox.ts` derivation test (behaviour in, behaviour out).

## Out of Scope

Everything in ADR-0006: real-time sync/SSE, multi-user, auth, comments, mentions, notifications, saved views beyond URL params, custom statuses, `needs_human`, labels, milestones, priority, claim order, scope/lane/acceptance/budget, design revisions/shas/repository access, stored HTML, runs/evidence/leases/costs, import/export (including the legacy Subway Reader ticket file), light mode, phone-specific features beyond the responsive layout, deployment, an in-tracker planning feature. Also out: the dependency graph being editable by drag; a Home screen distinct from the kanban; ticket deletion.

## Further Notes

- The blueprint's authority rules are unchanged; only names moved. When S5 flips `ready → building` and `building → review` to controller ownership, the board should refuse those drags with the table's hint and nothing else should change — build the table with that day in mind.
- S2 will snapshot ticket description + design + project design at claim time; keep those as plain text so the copy is trivial.
- Keep `docs/LESSONS.md` from the first day of implementation (v0 postmortem §7.12).
