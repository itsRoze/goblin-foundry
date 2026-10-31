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

Always pass `--actor agent`, or export `GF_ACTOR=agent`. Actor is a record, not
a permission (ADR-0012): either Actor makes every transition and creates in any
status but `done` and `cancelled`, and history says whose hands made each
change. That record is only true if you pass the flag on every call.

The human's instruction is the authority. Make the moves the workflow you are
running makes, below, and nothing it doesn't. When the human wants to sign off
first, create in `planning` and stop: a ticket parked there is the human's
Attention, and `approve` waits for their word.

## The three workflows

Each one moves tickets differently. Find the one you are in.

### Spec first: to-spec → to-tickets → implement-spec

- **to-spec** writes the spec as a project's design (`goblin project create`,
  then `goblin project design set`). It moves no ticket.
- **to-tickets** shows the breakdown and waits for the human's OK. That OK is
  the approval, so it then creates each ticket straight in `ready`, inside the
  spec's project, with its blockers (see "publish to the issue tracker"). If the
  approve guard refuses a create, the 422 names what is missing: create in
  `todo`, add it, then `approve`.
- **implement-spec** works the ready frontier: for each ticket, `start` it
  (`ready → building`), build it, open the PR, then follow "When you open a PR
  for a ticket".

### No spec: poteto mode

The human says "do X". Create the ticket for X directly in `building`, so the
work is on the board the moment it starts:

    goblin ticket create --actor agent --status building --simple \
      --title "<title>" --app goblin-foundry-2

Drop `--simple` and give it a `--description` (or a design) when the title
alone does not carry the work. Then follow "When you open a PR for a ticket".

### Wayfinder

A map of decisions rather than a build. See "Wayfinding operations".

## When you open a PR for a ticket

The agent that built a ticket links every PR it opens for it, stacked ones
included, as soon as each is open:

    goblin ticket link add --actor agent <key> --url <pr-url>

Then it submits the ticket:

    goblin ticket submit --actor agent <key>

That moves it `building → review`. When you have verified the PR merged
(`gh pr view <pr-url> --json state` says `MERGED`), ship it:

    goblin ticket ship --actor agent <key>

A PR still open or closed unmerged leaves the ticket in `review`.

## Wayfinding operations

Wayfinder's vocabulary maps onto Goblin like this:

| Wayfinder    | Goblin                                                                    |
| ------------ | ------------------------------------------------------------------------- |
| the map      | a Project; its design is the map's index (`goblin project design set`)    |
| a decision   | a ticket in that project, created in `ready` so it is on the frontier     |
| its type     | one Label: `wayfinder:` + `research`, `prototype`, `grilling` or `task`   |
| claim it     | `goblin ticket start` (`ready → building`)                                |
| answer it    | the ticket's design (`goblin ticket design set`)                          |
| resolve it   | `goblin ticket close` (`→ done` from any status before `review`)          |
| the frontier | `goblin frontier --project <map>`; add `--label wayfinder:<type>` for one |

Create a decision with its type:

    goblin ticket create --actor agent --status ready --project <map> \
      --title "Which feed parser" --description @<path> \
      --labels wayfinder:research

The title is the question alone; the Label carries the type, and the
description is enough for the approve guard. Every decision of a type, open or
not: `goblin ticket list --project <map> --label wayfinder:research`.

Declare one decision's reliance on another as a dependency, so the frontier
shows only the decisions that are open to take.

## When a skill says "publish to the issue tracker"

    goblin ticket create --actor agent --status <status> \
      --title "<title>" --description @<path> --app goblin-foundry-2

`--status` is the workflow's: `ready` for to-tickets, `building` for poteto
mode, `planning` to park it for the human's sign-off. Without it a ticket lands
in `backlog`. `--description` and `--design` take literal text, `@<path>`, or
`-` for stdin. The description is enough for the approve guard; a ticket design,
when the slice needs a plan, is a second call:

    goblin ticket design set --actor agent <key> @<path>

A ticket whose title says it all takes `--simple` instead.
Declare blockers rather than ordering tickets by hand:

    goblin dependency add --blocker GF-12 --blocked GF-13

Several tickets at once take one batch: `goblin ticket approve GF-1 GF-2 GF-3`
moves all of them or none.

## When a skill says "fetch the relevant ticket"

`goblin ticket show <key>` — a bare number works, so `12` means `GF-12`. It
returns the ticket with the edges on both sides of it. `goblin ticket list`
filters with `--app`, `--project`, `--status a,b`, `--label a,b` (any of them)
and `--q <text>`. `goblin label` lists the label names already in use, so a
new ticket reuses one rather than inventing a near-twin.

## When a skill asks what to work on next

`goblin frontier` — the ready tickets with nothing in their way, stalest first.
That is the queue, and it is the only queue.

## Specs and designs

There is no separate spec location. A project's design (`goblin project design
set`) holds what a spec would; a ticket's design holds the per-ticket detail.
Both are raw markdown and both are tracker records, not files (ADR-0005).

## What is not here

Goblin has no assignee and no comment thread. Don't simulate them in a
description: the triage roles that would lean on them are Labels, see
`triage-labels.md`.

## The historical record

`docs/tickets/s1/` and `docs/tickets/later/` are the hand-written S1 plan, which
predates this tracker. They were deliberately not migrated. Read them as
history; write new work to Goblin.
