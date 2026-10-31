---
status: accepted
date: 2026-10-30
amends: ADR-0003
---
# Actor is a record, not a permission

ADR-0003 gave every Transition an owner and held an agent to `planning`: it created tickets only there and owned one edge, `submit`, so the Ready Frontier was reached only by a human's hand. In practice that made Goblin Foundry one workflow rather than a tracker for several. Grill → to-spec → to-tickets → implement-spec stalled on two human clicks per ticket (`approve`, `start`) after the human had already accepted the breakdown; wayfinder's decision tickets could not be claimed or resolved by the agent working them; and implementing without a spec (poteto mode) needed approval of work the human had just asked for. The human's instruction is the authority; making them relay it through the board was ceremony.

In the Goblin Foundry Assembly, either Actor may trigger every Transition and create a Ticket in any creatable Status, with the same default (`backlog`). Actor stays on every event, so history still says whose hands made each change. `approve` now means "this plan is accepted", by whoever accepts it; a workflow that wants the human's sign-off parks its Tickets in `planning` and says so.

The approve guard keeps its App requirement and accepts a description in place of a Ticket Design: it asks that intent is written down, not where. `simple` now means the title alone carries it.

## Considered options

- **Keep `approve` human-owned, hand the agent everything else.** Rejected: to-tickets already shows the breakdown and waits for the human's OK before publishing, so a second approval is the same decision twice.
- **Keep the ceiling and lean on bulk approve.** Rejected for the same reason, and it does nothing for poteto mode or wayfinder.

## Consequences

- `AGENT_CEILING` and the agent-only refusals go; every edge in `transitions.ts` is owned by both Actors. The workflow engine keeps owners for other Assemblies.
- GLOSSARY.md's Actor, Attention, Approve Guard, Simple and Transition entries change with this. PRODUCT.md's agent rule and `docs/agents/issue-tracker.md` follow.
- The tracker doc now names three workflows and how each moves Tickets: to-tickets creates in `ready`; implement-spec and poteto mode start, link, submit, and `ship` after a merge they have verified; wayfinder maps onto a Project (its Design the map) and decision Tickets claimed by `start` and resolved by `close`.
