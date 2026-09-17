# Goblin Foundry — domain context (S1)

Glossary of the tracker's language. No implementation details here; decisions live in `docs/adr/`.

## App
A product the factory works on; owns one git repository. Contains Projects and Tickets. Renamable; identity is an opaque id, not its name.

## Project
A body of work (e.g. "Subway Reader MVP"), usually inside an App. May exist with no App (created before it is known where it belongs) and may be moved to another App later; its Tickets go with it. Has a Project Design and contains Tickets. Renamable; identity is an opaque id, not its name.

## Archived
A reversible condition on an App or Project: out of the way, not gone. An archived thing is hidden from lists and pickers by default but still opens by its address; its Tickets are untouched and stay on the board. Archiving is about navigation, never workflow. A Ticket is never archived — it is `cancelled` (a workflow decision) or Trashed (a mistake).

## Trashed
A recoverable deletion of an App, Project or Ticket (something created by accident). A trashed thing is hidden everywhere and can be restored; after a grace period it is gone for good. Distinct from Archived (out of the way) and from `cancelled` (a decision not to do a Ticket).

## Milestone
A named grouping of Tickets inside a Project. Not in S1 (wanted later).

## Design
A markdown document describing intent, stored in the tracker as part of the thing it describes: a **Project Design** (the shape of a project) or a **Ticket Design** (the plan for one Ticket). A living document — edited in place, always live (there is no draft and no save step); not versioned in S1. *(Later slices snapshot it at claim time so a run is judged against the design it started with.)*

## Ticket
A unit of work — or, early in its life, just an idea. May belong to an App and a Project, or to neither (an orphan Ticket is an idea and can never become `ready`). A Ticket in a Project always shares that Project's App; a Ticket's App is chosen directly only when it has no Project. Has a Status, a description, and optionally a Ticket Design. A Ticket flagged **simple** needs no Ticket Design to become `ready`. Identified by a global sequence number shown with a configurable prefix (`GF-12`); the number is never reused.

## Ticket Key
The display form of a Ticket's number: `<prefix>-<number>`, prefix configurable once per installation (default `GF`). Apps and Projects do not have keys.

## Ticket Dependency
A directed "A blocks B" relationship between two Tickets. B cannot proceed until A is done. Unconstrained by App or Project; only cycles are refused, judged over every declared edge whatever its Status (a reopened Ticket must never reveal a cycle nobody was asked about). An edge may be declared against an already-`done`/`cancelled` blocker — a true fact, inert unless the blocker is reopened. Edges survive a trip through the Trash; a new edge may not touch a Trashed Ticket. Advisory for humans: it never forbids a Transition (the board asks before `start`ing a blocked Ticket); the enforcement point is the Ready Frontier. (ADR-0009.)

## Blocked
A *derived condition*, not a Status: a **non-terminal** Ticket (`backlog` through `review`) with at least one **open** blocker — a `done` or `cancelled` Ticket has nowhere left to proceed, so it is never blocked. A blocker is open unless it is `done`, `cancelled`, or Trashed — a cancelled Ticket means "not doing" and blocks nothing; a Trashed blocker stops blocking until restored. Never a colour in the UI (outline glyph + strikethrough).

## Lifecycle / Status
Workflow state only (never CI or PR review state). S1 statuses, in order:

- `backlog` — an idea; not now, maybe for a while
- `todo` — decided: plan this next
- `planning` — planning conversation / design in progress
- `ready` — plan approved; developable
- `building` — someone is on it (you by hand; the controller from S5)
- `review` — PR open / being reviewed
- `done` — finished, however it got there: shipped out of `review`, or closed because it turned out to be done as a side effect of other work
- `cancelled` — not doing; blocks nothing

`needs_human` (agent stuck) is added when a controller exists (S5). Transitions are a code-owned table; every Transition names its owner. In S1 all are human-owned.

## Ready Frontier
The set of Tickets the controller may claim: `ready` ∧ no incomplete blocker ∧ not leased (∧ within concurrency/risk limits, later). Computed, never stored.

## Claim Order
The human-chosen ordering of the Ready Frontier; the controller takes the first. Not in S1 (arrives with the controller).

## Lease
The controller's atomic hold on a Ticket while a run is alive. Expiry routes to `needs_human`; it never re-queues. Not in S1.

## Attention
Everything waiting on the human: approvals, re-arms, answers, reviews, design reconciliations. In S1 only approvals exist (Tickets in `planning`); there is no Home screen — the Kanban is home.

## Simple
A flag on a Ticket meaning "straightforward enough to build without a Ticket Design". A simple Ticket may go `todo → ready` directly, and may be *created* in `ready`. Simple means no plan is needed, not that no context is needed: a simple Ticket still needs an App, because an orphan can never be `ready`.

## Lane (risk lane)
The human review depth a Ticket requires: `L3` (read the full diff) or `L4` (spot-check with evidence). Not in S1; set at intake from S2.

## Actor
Who performed a mutation — the hands, never the authority: `human` or `agent` (an AI creating or editing on the human's behalf, e.g. the planner). An agent acting on the human's instruction is still `agent`. Every mutation records actor, prior state, new state, timestamp. Later slices add `controller`.

In S1 an agent's reach ends at `planning`: it creates Tickets only into `planning` (any other Status is refused, never silently corrected) and it owns no Transition, so approving what an agent planned is always a human act. The Ready Frontier is therefore only ever reached by a human's hand.

## Edit session
A stretch of continuous editing of one thing by one Actor, recorded as a single entry in that
thing's history rather than one entry per keystroke's worth of saving. What it remembers is the
text as it stood when the sitting began, so an edit session is the unit of recovery for a
Design. A human's session and an agent's session are always distinct, even back to back.
(ADR-0008.)

## View option
A per-device display preference on the Kanban: which card properties are shown. It decides how the board shows what the Filter chose, never *which* Tickets are on it, so it never hides a Status.

## Filter
Which Tickets are on the board: any combination of an App, a Project, a set of Statuses, and text matched against title or description. Lives in the board's address, so a bookmarked URL is a saved view. The default Status set is the seven live statuses; `cancelled` is on the board only when the Filter names it. The Filter chooses, the View option dresses; the two never overlap.

## Scope
The App or Project a screen is narrowed to: the thing an App or Project view is about, or the App and Project a board Filter names. A new Ticket starts in the Scope on screen.

## Focused tile
The one tile on a screen that keys address; its border says which. Every screen has exactly one, and the Cursor lives inside it.

## Cursor
The one card or row on screen that keys act on: move it, open it, act on the Ticket under it. There is at most one; it sits in the Focused tile and is remembered by Ticket Key, so a refresh or a trip into the Ticket view and back does not lose it. The **current Ticket** is the open Ticket on a Ticket view, otherwise the Ticket under the Cursor — it is what a status change or a command palette action applies to. Not a Selection.

## Selection
A set of Tickets belonging to the current filtered board, gathered for one all-or-none bulk action; success clears the set, while refusal preserves it (issue 03b). A Cursor is where you are and a Selection is what you have gathered; the two coexist and never mean each other.

## Transition
One arrow in the Lifecycle: a named move of a Ticket from one Status to another (e.g. `ready → building`, named `start`). Each Transition has a **name** and an **owner** — who is allowed to trigger it. A Ticket's current Status plus a name identifies exactly one arrow. Dragging a card between kanban columns *is* a Transition; the board only offers arrows the dragger owns.

The S1 verbs: `pick`, `plan`, `shelve` (moving freely among `backlog`/`todo`/`planning`), `approve` and `unapprove`, `start` and `stop`, `submit`, `ship`, `close`, `cancel`, `reopen`. Two of them share a destination: **ship** is a PR merged out of `review`; **close** records a Ticket that turned out to be done without ever being planned. **Reopen** takes a cancelled Ticket back to `backlog` — distinct from *restoring* one, which is un-Trashing it.

## Approve Guard
What a Ticket must have before it may be `ready` or beyond: an **App**, and a **Ticket Design** unless it is Simple. It is the single gate into the Ready Frontier — the same check whether the Ticket walks there, is created there, or is edited while there. A description is not part of it: intent lives in the title of a Simple Ticket and in the Design of any other.
