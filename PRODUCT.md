# Product

<!-- impeccable:product-schema 1 -->

A digest for design work, which is what impeccable reads. The sources of truth stay where they are: the domain language in `CONTEXT.md`, decisions in `docs/adr/`, the S1 spec in `docs/specs/S1-tracker-core.md`, the house style in `design/DESIGN.md`, and for the factory beyond S1 the blueprint `BLUEPRINT-v1.md` and the notes under `research/`. When this file and one of them disagree, the source wins and this file is corrected.

## Platform

web

## Users

One person: the solo developer who is building the factory and runs it. Keyboard first, at a laptop or a wide monitor for planning and building, and at phone width for triage (spec story 44). In S1 they operate the tracker entirely by hand, often with a Claude Code planning session in a terminal beside the browser (story 45). From S5 a controller and its agents act on the same tickets (`needs_human`, leases, runs) and the human becomes the one who approves, re-arms and answers.

Other solo developers who adopt the factory once it is open source are **not a design audience yet** (decided 2026-09-03): the operator knows the system's language, and no onboarding or self-explanation is owed to a stranger. Revisit when adoption is planned.

## Product Purpose

Goblin Foundry is a solo software factory. S1 is its tracker: a durable place for Apps, Projects, Designs and Tickets that the human operates by hand. Capture an idea, plan it into vertical-slice tickets with a planning agent, declare what blocks what, approve plans, and see at a glance which tickets are actually ready to build (the Ready Frontier).

S1 is done when a fresh project is created in the GUI, an agent-assisted planning conversation produces approved tickets with dependencies through the API, tickets drag between statuses, and the ready frontier is correct on screen (the spec's exit criterion). The factory succeeds when one complete workflow runs end to end on one real product, Subway Reader, before anything is generalised (BLUEPRINT-v1 §1, `research/CRITIQUE-AND-PROPOSED-DIRECTION.md`).

## Positioning

A control surface and a memory, not a Linear clone. Status is a code-owned state machine whose transition table names an owner per edge, so when the controller arrives its columns refuse a drag and say why: authority is visible in the UI. Linear and GitHub Issues cannot express factory authority, and the human does not own them (v0 postmortem, BLUEPRINT-v1 §1).

## Operating Context

One Bun process on localhost: a typed HTTP API over one SQLite file, serving a thin web GUI; a `goblin` CLI wraps the API for the planning skill. No auth, no multi-user, no sync, no deployment. Screens: the kanban is home; Ticket, Project, App, the Apps and Projects lists, Settings, Trash. Every long text field is a Linear-style markdown editor that is also the read view (ADR-0005). Tickets are planned by hand or by a planning agent over the `goblin` CLI, and built by hand until the controller arrives (S5). Changes made from the terminal are meant to show up on the board within seconds, without a reload (story 45).

The first product built with the factory is Subway Reader, an offline-first e-ink RSS reader for Android (`research/subway-reader/`); it enters as a freshly planned project created through the tracker (ticket 12).

## Capabilities and Constraints

One line each; the spec carries the user stories.

- Statuses `backlog · todo · planning · ready · building · review · done · cancelled`, moved only by named transitions (`approve`, `start`, `ship`…). Blocked is a derived condition, never a status.
- Every transition names its owner. In S1 every edge is human-owned; the owner is in the table so that when `ready → building` and `building → review` pass to the controller in S5 (ADR-0003), flipping ownership changes no UI code (story 30).
- An agent creates a ticket only into `planning` (the default when it names none; any other status is refused, never corrected) and owns no transition, so approving what an agent planned is always the human's act (CONTEXT.md Actor; decided in ticket 09).
- Dependencies are advisory facts between any two tickets; only cycles are refused (ADR-0009). The Ready Frontier is where they bite.
- Trash is the undo; archive is navigation; cancel is the workflow decision. Nothing is lost by a workflow action.
- Designs are markdown columns in the tracker, edited in place, always live; there is no draft and no save step (ADR-0005). Editing text never changes status.
- Not in S1 (ADR-0006): runs, evidence, leases, costs, `needs_human`, labels, milestones, priority, claim order, light mode, deployment, an in-tracker planning feature.
- Terminology is fixed by `CONTEXT.md`: App, Project, Ticket, Ticket Key, Design, Transition, Ready Frontier, Approve Guard, Edit session, View option, Filter. Use those words.

## Brand Commitments

Name: Goblin Foundry. Voice (DESIGN.md Voice): short, plain, sentence case; kinds and states are single words; hints are a verb with a key; numbers are honest and never a pie chart; no exclamation marks.

The look is the house style in `design/DESIGN.md`, and it is binding. This file does not restate it.

## Evidence on Hand

- The mockups that produced the house style: `design/rough-v5/` (Kanban, Ticket, Project, Components, Tokens); earlier rounds in `design/rough-v0…v4/`. Ideas, not commitments.
- Real content for the first project: `research/subway-reader/PROJECT-DESIGN.md` and `TICKETS-v0.md`. Reference only; the plan is re-made through the tracker.
- The browser suite `e2e/*.e2e.ts` is the exit criterion made executable, including the layout tiers in `e2e/z-responsive.e2e.ts`. `.claude/skills/ui-closeout/serve.ts` serves the built GUI over a scratch database seeded with one small world, for design review.
- No logo, wordmark, icon set, characters or illustration exist. Do not invent them; DESIGN.md Deliberately not specified says when an icon set may arrive.
- No customers, testimonials, benchmarks, pricing or press. Do not invent any.
- Open source is the intent (BLUEPRINT-v1 §1); no licence has been chosen and there is no LICENSE file. Undecided.

## Product Principles

1. Agents produce candidates; deterministic code enforces boundaries; evidence informs trust; the human owns intent and irreversible decisions (BLUEPRINT-v1 §1).
2. The transition table is the only authority over status; nothing else encodes the lifecycle, and a refusal says who owns the move.
3. Nothing is lost by a decision: cancel has `reopen`, archive has unarchive, trash has restore. Only cancel is a workflow action; archive is navigation and trash is the undo.
4. Keyboard first: every tile header shows its keys, and a drag always has a key that does the same thing.
5. Numbers you read, not numbers you admire.

## Accessibility & Inclusion

Four standing commitments, and no external standard named (decided 2026-09-03):

- Every text colour clears 4.5:1 on the tile surface; the palette was adjusted for it (DESIGN.md Colors). The dim token is for handles and dividers only and fails contrast deliberately.
- Blocked is never a colour: an outline glyph plus strikethrough. No status is carried by colour alone; the word is always there.
- `prefers-reduced-motion` collapses transitions and switches the one ambient animation off.
- The keyboard reaches everything, and focus is always visible: a 1px `--gf-system` outline on anything focusable, the caret inside an editor. The browser's own rounding of that outline is let be.
