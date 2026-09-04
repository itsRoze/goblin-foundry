---
name: ui-closeout
description: Use at the close-out of /implement when the diff touches web/src, design/DESIGN.md or design/tokens.css, after the tests pass and before Matt's code review (mattpocock-skills:code-review, not the built-in /code-review) and the commit. Serves the built GUI over a scratch database, critiques each touched screen against DESIGN.md, polishes.
---

# UI close-out

Matt's code review (`mattpocock-skills:code-review`, the two-axis one, not Claude Code's built-in `/code-review`) reads the diff against the spec. This reads the screen against DESIGN.md. It runs once per UI ticket: after the tests pass, before that review (so the polish edits are reviewed with the rest) and the commit.

## 1. Is this a UI ticket?

```bash
git diff --name-only "$(git merge-base main HEAD)" HEAD -- web/src design/DESIGN.md design/tokens.css; git status --porcelain -- web/src design/DESIGN.md design/tokens.css
```

Nothing listed: say so in one line and stop. Otherwise map the paths to the screens they render; those are the targets, at most three, the board first when it is among them. A path with no row (`web/src/api.ts`, `web/src/queries.ts`, `web/src/main.tsx`) renders no screen; when those are the only paths, say so and stop.

| Path | Target: the screen's source file | Route in the seeded world |
|---|---|---|
| `web/src/pages/Board.tsx`, `web/src/tickets.tsx` | `web/src/pages/Board.tsx` | `board` |
| `web/src/pages/TicketView.tsx`, `web/src/editor.tsx`, `web/src/markdown.ts`, `web/src/reveal.ts` | `web/src/pages/TicketView.tsx` | `ticketBlockedWithDesign` |
| `web/src/pages/ProjectView.tsx`, `web/src/graph-view.tsx`, `web/src/graph.ts` | `web/src/pages/ProjectView.tsx` | `project` |
| `web/src/pages/AppView.tsx`, `web/src/pages/Entity.tsx` | `web/src/pages/AppView.tsx` | `app` |
| `web/src/pages/Apps.tsx`, `web/src/pages/Projects.tsx` | that page | `apps`, `projects` |
| `web/src/pages/Settings.tsx`, `web/src/pages/Trash.tsx` | that page | `settings`, `trash` |
| `web/src/shell.tsx`, `web/src/ui.tsx`, `web/src/keys.tsx`, `web/src/app.css`, `design/tokens.css`, `design/DESIGN.md` | every screen: the board, the ticket and the project | `board`, `ticketBlockedWithDesign`, `project` |

## 2. Serve a screen worth looking at

```bash
bun .claude/skills/ui-closeout/serve.ts start
```

Builds the GUI, starts the API on a free port over a scratch database, seeds one small world (two apps, three projects, thirteen tickets with every column of the board filled, a blocker, a design, a trashed ticket) and prints `url` and the `routes` named above with real ids. Nothing touches `~/.goblin-foundry/foundry.db`. The server reads `web/dist` per request, so after an edit `bun run build` refreshes the screen with no restart; `--no-build` skips the first build unconditionally and only checks that `web/dist` exists, so use it only when nothing under `web/` or `design/` has changed since the last build.

## 3. Critique, then polish, per target

The target of both commands is the file, so the snapshot's slug and fingerprint stay stable from run to run; the URL only says where the browser looks. Its port changes every start, so it must never become the target.

1. `/impeccable critique web/src/pages/Board.tsx, rendered at <url>/`. Two assessments, a report, a snapshot under `.impeccable/critique/`; the standing house exceptions are in `.impeccable/critique/ignore.md`. When the report lists three or more priority issues, critique ends by asking which matter: answer, and polish inherits the answer.
2. `/impeccable polish web/src/pages/Board.tsx, rendered at <url>/`. It reads that snapshot as its backlog. Fix what polish fixes: alignment, spacing, a missing state, a token where a literal crept in, copy that breaks DESIGN.md Voice. A structural finding (hierarchy, information architecture, a flow) is written down, not built: an *Open question* heading in the PR body, or `docs/tickets/later/<slug>.md` when it is a ticket.
3. `bun run build`, then look again: polish's own last pass and the next target's critique must see the polished screen, not the bundle from step 2.

A finding that contradicts a DESIGN.md section is refused with the section name: the brief wins over impeccable's category defaults, and `bun run lint` refuses radius, shadows and gradients anyway. When the house style is wrong, change DESIGN.md first and let the command follow. A polish that changes something DESIGN.md specifies updates the matching "As built" note in the same commit: drift is allowed, unexplained drift is not.

## 4. Prove it and put the server away

```bash
bun run lint && bun run typecheck && bun test && bun run test:e2e
bun .claude/skills/ui-closeout/serve.ts stop
```

Then `mattpocock-skills:code-review` and the commit, as `/implement` says. In the commit message or PR body, one short block per target: the critique's score and P0/P1 count, what polish changed, what was left and where it was written down.

Done when `ls .impeccable/critique/*__<slug>.md` lists a file per target (the slug comes from `critique-storage.mjs slug <file>` in impeccable's scripts folder; a `closed: true` line in the file means polish cleared its backlog), every P0 and P1 is fixed or written down, the four commands above are green, and `bun .claude/skills/ui-closeout/serve.ts status` prints `nothing running`.
