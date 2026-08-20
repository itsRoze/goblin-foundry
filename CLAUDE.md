# Goblin Foundry

A personal agentic software factory: a Linear-like ticket system on Rocicorp Zero +
Postgres whose status transitions trigger Claude agents ("goblins") running via the
Claude Agent SDK in a worker, one `query()` per phase, one git worktree per ticket.
Everything the agents do streams into an event log rendered as swim lanes.

The spec is `docs/plan/factory-blueprint.html`. Read it before changing architecture.
Research behind it is in `docs/research/`. Milestone scope is `docs/prompts/m0-kickoff.md`.

## Layout

    apps/web         Vite + React + Zero client — board, ticket, run trace, approvals
    apps/api         Hono — Zero push/query endpoints, SSE event feed, approvals, policy
    apps/worker      Agent SDK runner — claims tickets, worktrees, phases, gates, PRs
    packages/schema  Zero schema + Postgres DDL + zod types (envelopes, gates, policy)
    packages/skills  SKILL.md for the planner (and later builder/reviewer/librarian)
    infra/           docker-compose: Postgres with wal_level=logical

## Commands

    just up             start Postgres (docker) and wait for it
    just migrate        apply pending SQL migrations · just seed  seed the factory project
    just reset          nuke + up + migrate + seed
    just zero           run zero-cache (must run from the repo root)
    just api            the API: SSE feed, designs, approvals, /zero/query
    just web            the web UI on :5173
    just work           the worker: claim ready_for_dev tickets and build them
    just work-once      claim and build exactly one ticket, then exit
    just install-skills link packages/skills into .claude/skills so /plan works here
    just psql           psql into the factory database
    pnpm typecheck      typecheck every package
    pnpm test           run every package's tests

Bring the whole thing up in four terminals: `just up` once, then `just zero`,
`just api`, `just web`, and `just work` when you want the goblins awake.

## The loop

`/plan <ticket>` in your own terminal writes a design into the factory and moves
the ticket to Design Review. Approve it in the web UI and the ticket lands in
Ready for Dev; the worker claims it, builds it in a worktree, runs the gates, and
moves it to In Review with a branch (and a PR once the project has a remote).

## House rules

- Designs are stored, never committed. Design markdown lives in the factory DB; the
  worker materializes it into a worktree at a git-ignored path at run start. Never
  create `docs/designs/` in a target repo.
- A ticket is not a run: Ticket → Run → Phase → Event. Attempts, cost, and evidence
  live on the run.
- Code owns sequencing; agents own one bounded phase returning a typed envelope.
  Gates verify the envelope's claims and record evidence — `{item, ok, note}`, not a bool.
- Failed gate → re-prompt the same session (correction, not restart), bounded by policy.
- Append decisions to `docs/DECISIONS.md` and things that bit you to `docs/LESSONS.md`.
