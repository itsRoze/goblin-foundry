# 03: Tickets with keys, kanban home, ticket view

**What to build:** I can create a Ticket from a title alone — with or without an App or Project — and it gets a permanent key `GF-n` (prefix from settings, number never reused). I can edit title and description (plain textarea for now) and assign/move the ticket between apps and projects without the key changing; edits never touch status. The kanban is the home screen: eight columns in lifecycle order (`backlog todo planning ready building review done cancelled`), every ticket a card (key, status note, title, meta), no dragging yet; new tickets default to `backlog`. The Ticket view shows description, status, app, project, timestamps and a history tile built from its events. The board refetches every 5 s while visible and on window focus.

Respect ADR-0002 (keys) and ADR-0003 (statuses as a checked text column; `needs_human` absent; guard on create).

**Blocked by:** 02 (Apps and Projects)

**Status:** ready-for-agent

**Decisions (grilled 2026-08-28):**

- *Schema.* `ticket` (already a stub from 02) gains `description` (default `""`), `status` (checked text, eight values), `simple` (default false), `design` (nullable) — in both `schema.ts` and `ensureSchema`. Key = `ticket.id` (AUTOINCREMENT, never reused); no separate counter.
- *Create.* `POST /api/tickets {title (trimmed, 1–200), description?, app_id?, project_id?, simple?, status?}`. `status` defaults `backlog`; any of the eight is accepted. `ready|building|review|done` run the approve guard — the guard is 04's code, so 03 accepts them and 04 adds the check (story 50 amended). ADR-0007 applied on create; a trashed or archived `app_id`/`project_id` → `422`.
- *Edit.* `PATCH /api/tickets/:key` accepts `title, description, app_id, project_id, simple, design`; `status` → `422`. No GUI for `simple`/`design` in 03 (04, 07).
- *Key resolution.* Lenient: `<alnum>-<n>` or bare `<n>` resolves to ticket n regardless of prefix; the response always carries the canonical current `key`. GUI URL `/tickets/GF-7`; a bare number or stale prefix redirects to the canonical key.
- *Settings.* `PATCH /api/settings {ticket_prefix}` (`^[A-Z][A-Z0-9]{0,7}$`, stored uppercase) with an event. The settings tile moves from the Board placeholder to a `/settings` route linked from the shell bar.
- *Trash.* `DELETE /api/tickets/:key`, `POST …/restore`; double-trash `409`; restore clears `project_id` (and `app_id`) if that parent is still in the trash (ADR-0007). `/api/trash` gains `tickets`. Dependency detach is a no-op hook until 05. In the GUI, trash is the last entry of the Ticket view's `state` tile (like Linear's status menu), `⌘⌫`, no confirm — restore is `r` in `/trash`. No trash action on cards.
- *Events.* Every mutation, description bodies included (S2 wants prior bodies); the history tile renders `description edited` as one quiet line. `created.new` includes status. Names resolved client-side from cached apps/projects (`#3` if gone): `created`, `renamed a → b`, `moved to project X`, `moved to app X`, `removed from project`, `trashed`, `restored`; actor shown when `agent`.
- *Board.* Cards ordered by `id` ascending within a column (stable under the poll). Card per DESIGN.md Components: key (mono) + status note coloured per Colors (`backlog/todo/planning` draft, `ready`/`building` system, `review` review, `done` mute, `cancelled` mute + struck), title, meta line `app / project` (`—` for orphans). View menu (`v`, persisted in `localStorage`): toggle `app / project` (default on) and `updated` (default off); show `cancelled` (default off). Key and status note are never hidden. Cancelled visibility is a **view option, not a filter** (CONTEXT.md; issue 06 amended).
- *Polling.* Board query: `refetchInterval: 5000`, `refetchIntervalInBackground: false`, refetch on focus. Ticket view: refetch on focus only (poll arrives with 09).
- *Ticket view tiles.* `about` — title inline edit; description textarea (`e` edit, `⌘⏎` save, `esc` cancel, so 07 swaps the widget without changing keys); app and project as native `<select>`s (archived/trashed hidden; picking a project sets both; changing the app clears the project client-side); `created`/`updated` relative (`3m`, `2h`, `4d`, short date after 7 days), ISO in the tooltip, re-rendered every 60 s. `state` — status chip read-only (04 adds buttons) + `trash`. `history`.
- *Create key.* `c` creates a ticket wherever there is a scope: board → inline title input at the top of `backlog`; App/Project view → prefilled with that scope. `n` is retired; 02's inline app/project forms open from a clickable `+` in the tile header until `⌘K` (10) takes over. `c` does nothing on the all-apps / all-projects lists. `⌘⏎` saves, `esc` cancels.
- *Fill 02's empty tiles.* App and Project views' `tickets` tiles list key, title, status chip; row click opens the ticket.
- *Not in 03.* Multi-select and bulk edit → issue 03b. Transitions → 04. Filters → 06. Markdown editor → 07.

- [ ] Schema columns above; `POST /tickets` with only a title succeeds; response carries `key` (`GF-7`) and `id`; routes accept key (any prefix) or bare number; `status` in `POST` accepted, default `backlog`
- [ ] `PATCH /tickets/:key` edits title, description, app, project, simple, design; a `status` field in the body is rejected
- [ ] `PATCH /settings` changes the prefix; displayed keys change everywhere, numbers unchanged; `/settings` page; settings tile removed from the board
- [ ] Kanban home renders eight columns with cards coloured by status per DESIGN.md Colors, ordered by id; view menu (`v`) with `app / project`, `updated`, `show cancelled`, persisted per device
- [ ] Ticket view (`/tickets/:key`, redirects to canonical) with `about`, `state` (trash), `history` tiles; history reads `GET /tickets/:key/events`
- [ ] 5 s poll and refetch-on-focus on the board via the query cache
- [ ] `c` creates a ticket on the board and in App/Project views (scoped); `n` retired, `+` click for apps/projects; App/Project `tickets` tiles filled
- [ ] Ticket ↔ Project ↔ App rule per ADR-0007 on create and patch: `project_id` fills `app_id`, mismatch `422`, app change clears project; trashed/archived parent `422`
- [ ] Ticket trash: `DELETE /tickets/:key`, `POST …/restore` (clears trashed parents), `/trash` view gains a tickets tile; `/api/trash` returns `tickets`
- [ ] API tests: key generation, orphan ticket, lenient key resolution, move between projects keeps key, status rejected in PATCH, initial status honoured, prefix change, trash/restore (incl. restore with trashed project), events recorded incl. description bodies
- [ ] Browser smoke: `c` on the board creates a ticket in `backlog`, open it, edit the title, see the edit in history; toggle `show cancelled` and see the column; trash it and restore from `/trash`
