# 02: Apps and Projects

**What to build:** I can create an App (name, optional repository URL, optional default branch — only alongside a repository URL — and a short description) and a Project (name, description) either inside an App or with no App yet; rename either; move a Project between Apps (its tickets follow, per ADR-0007); archive/unarchive both; trash and restore both (children detached by default, `?cascade=1` trashes them too). Views: an all-apps list (`3 app`), an all-projects list grouped by App with a "no app" group (`2 project`), an App view (`projects`, `tickets` — empty for now —, `about`, `history` tiles), a Project view (`tickets` — empty —, `about`, `history`), and a `/trash` view that lists and restores. GUI URLs are `/apps/<slug>-<id>` and `/projects/<slug>-<id>`; the id resolves, a stale slug redirects. Every write records an `event` row (`entity_kind`, `entity_id`, actor from `X-Goblin-Actor` defaulting to `human`, kind, prior, new, at), readable per entity newest first. Errors per ADR-0004.

**Blocked by:** 01 (Repository and workspace scaffold)

**Status:** done (merged to main 2026-08-28 with review fixes, fada5f2)

**Decisions (grilled 2026-08-27):** ADR-0007 for the ticket/project/app rule and detach-on-trash; CONTEXT.md for Archived vs Trashed vs `cancelled`. Not in this issue: ticket trash (03), the `⌘K` palette (10), `goblin trash purge` (09), Project `design` (07). Spec stories 18 and 32 already amended.

- [x] Schema: `app`, `project` (with `archived_at?`, `trashed_at?`), single `event` table; `ensureSchema` kept in step
- [x] `POST/GET/PATCH /api/apps`, `/api/projects` with zod bodies; `PATCH` accepts `name`, `description`, (`repository_url`, `default_branch`) / (`app_id`); `archived_at`/`trashed_at` in a body → `422`; `default_branch` without `repository_url` → `422`; `repository_url` must be a URL when present
- [x] Intents: `POST …/:id/archive|unarchive`, `DELETE …/:id[?cascade=1]` (trash), `POST …/:id/restore`; archive/trash of an already-archived/trashed thing → `409 {hint}`; list endpoints hide archived and trashed by default, `?archived=1` reveals archived; a trashed entity's `GET` → `404` except through `/api/trash`
- [x] Trashing an App detaches its Projects and project-less Tickets (events on each child); trashing a Project detaches its Tickets; restore does not re-attach. Cascade trashes children marked as taken-by-parent so restore revives exactly those
- [x] Moving a Project (`PATCH {app_id}`) rewrites `app_id` on all its tickets with an `updated` event per ticket
- [x] `X-Goblin-Actor: human|agent`, absent → `human`, anything else → `422`. Event kinds in `shared`: `created | updated | archived | unarchived | trashed | restored` (`transitioned` arrives in 03); `prior`/`new` hold only changed fields, `prior` null on create
- [x] `GET /api/apps/:id/events`, `GET /api/projects/:id/events` newest first; `GET /api/trash` lists trashed apps and projects with trashed-at
- [x] Web: `react-router`; lists, App view, Project view, `/trash` per DESIGN.md (bar with breadcrumb `app / project`, tiles, rows, kv `about`, history tile rendering `updated` on `name` as "renamed a → b"); archived chip on archived views; `n` opens an inline create form in the relevant tile, `⌘⏎` saves, `esc` cancels; `r` restores in trash
- [x] API tests: create both; rename; orphan project then attach; move project carries tickets (stub tickets via direct insert until 03); validation shape; 404 shape; actor `agent` recorded; archive hides/`?archived=1` reveals; trash detaches vs cascade; restore; double-archive `409`
- [x] Browser smoke: create an app and a project through the forms, see them in the views, rename, archive, trash and restore
