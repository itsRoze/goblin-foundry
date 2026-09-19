# Issue tracker: Goblin

Issues for this repo live in Goblin, the tracker this repo builds. It runs as a
macOS LaunchAgent at `http://127.0.0.1:4747`; the GUI is that same URL. This
app is registered in it as **`goblin-foundry-2`** — an app, project or
ticket is addressed by its id or by `<slug>-<id>` as the GUI writes it, never by
its bare name.

## Invoking it

`goblin` is on `PATH` (a symlink in `~/.local/bin` pointing into this checkout),
so it works from any directory:

    goblin <noun> <verb> [operands] [flags]

If it is missing — a fresh machine, or this checkout moved — restore it with:

    ln -sfn <checkout>/cli/src/goblin.ts ~/.local/bin/goblin

`GF_URL` points at the API (default `http://127.0.0.1:4747`). Exit codes: 0 done,
1 the API refused, 2 usage, 3 the API is unreachable. A refusal is
`application/problem+json` on stderr and stdout stays empty, so read stderr when
a command fails and `goblin … | jq` is safe on any exit code. Output is always
the API body, as JSON.

Run `goblin --help`, then `goblin <noun> --help`, then
`goblin <noun> <verb> --help`. That help is generated from the command table, so
it cannot go stale; prefer it over anything written here.

## An agent acts as an agent

Always pass `--actor agent`, or export `GF_ACTOR=agent`. This is not cosmetic:
the API holds an agent to `planning` (ADR-0003, `AGENT_CEILING`). An agent
creates tickets in `planning` and owns no lifecycle edge, so **an agent never
approves a ticket into `ready`**. Reaching the ready frontier is a human's hand,
every time. If a skill's instructions imply otherwise, stop and hand back rather
than acting as `human` to get past the refusal.

## When a skill says "publish to the issue tracker"

    goblin ticket create --actor agent \
      --title "<title>" --description @<path> --app goblin-foundry-2

`--description` and `--design` take literal text, `@<path>`, or `-` for stdin.
Then write the design, which is the body the approve guard looks for:

    goblin ticket design set --actor agent <key> @<path>

A ticket straightforward enough to need no design takes `--simple` instead.
Declare blockers rather than ordering tickets by hand:

    goblin dependency add --blocker GF-12 --blocked GF-13

## When a skill says "fetch the relevant ticket"

`goblin ticket show <key>` — a bare number works, so `12` means `GF-12`. It
returns the ticket with the edges on both sides of it. `goblin ticket list`
filters with `--app`, `--project`, `--status a,b` and `--q <text>`.

## When a skill asks what to work on next

`goblin frontier` — the ready tickets with nothing in their way, stalest first.
That is the queue, and it is the only queue.

## Specs and designs

There is no separate spec location. A project's design (`goblin project design
set`) holds what a spec would; a ticket's design holds the per-ticket detail.
Both are raw markdown and both are tracker records, not files (ADR-0005).

## What is not here

Goblin has no labels, no assignee and no comment thread. Don't simulate them in
a description; see `triage-labels.md`.

## The historical record

`docs/tickets/s1/` and `docs/tickets/later/` are the hand-written S1 plan, which
predates this tracker. They were deliberately not migrated. Read them as
history; write new work to Goblin.
