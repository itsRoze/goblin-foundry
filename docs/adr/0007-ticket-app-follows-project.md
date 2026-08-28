---
status: accepted
date: 2026-08-27
---
# A Ticket's App follows its Project; Projects may be app-less; a Project move carries its Tickets

Linear, Jira, GitHub Projects and Shortcut all make the owning unit (team / space / repo) a required, independent field on the issue and the project an optional grouping validated against it (research/tracker-project-team-models.md). We keep the invariant they converge on — **a Ticket in a Project has the Project's App** — but store both `app_id` and `project_id` on the ticket so the board's commonest filter needs no join. Setting `project_id` fills `app_id`; a mismatched `app_id` in the same `PATCH` is `422`; changing a ticket's `app_id` away from its project's app clears `project_id` (Linear's rule). We deviate in two places: `project.app_id` is nullable (a project can be created before its home is known; no surveyed tool allows this, but orphan Tickets already exist for the same reason), and moving a Project between Apps rewrites `app_id` on all its Tickets rather than dropping them — a solo factory's project is one body of work in one repository, so splitting it on move is never what was meant.

## Consequences

- Tickets in an app-less Project cannot be approved (the approve guard needs an App); attaching the Project fills every ticket's App at once.
- Trashing a Project detaches its Tickets (`project_id → null`, App kept); trashing an App detaches its Projects and project-less Tickets. Cascade is opt-in (`?cascade=1`).
- Dependencies are unconstrained by App or Project (any open ticket may block any other); the earlier cross-App refusal is dropped.
