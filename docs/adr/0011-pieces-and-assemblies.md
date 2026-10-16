---
status: accepted
date: 2026-10-16
---
# Goblin is built as Pieces; Goblin Foundry is one Assembly

Goblin becomes a set of Pieces, each one body of tracker behaviour that takes its rules as input. A developer builds their own ticket tracker by writing an Assembly in TypeScript that imports the Pieces and supplies the rules. Goblin Foundry is the first Assembly and keeps every opinion it has today.

The tracker is the first of several tools. The aim is open-source Pieces for the tools a software factory needs, such as an issue tracker, version control and an editor, so that anyone can build their own factory. The owner's factory is then built on those tools in an opinionated way. This replaces the BLUEPRINT-v1 build order (S2 to S7) as the plan.

## Considered options

- **Configuration, as in Jira workflow schemes or Beads formulas.** One shipped app whose statuses, transitions and hierarchy are edited at runtime. Rejected. A status set known only at runtime loses the compile errors that `Record<TicketStatus, …>` gives today and the database `CHECK` built from `TICKET_STATUSES`. The web app would need an endpoint to learn the workflow. A configurable tracker can still be built later as one more Assembly on top of the Pieces. Going the other way is much harder.
- **A plugin system on today's code.** Hooks around a core that keeps Goblin Foundry's rules. Rejected, because the rules are the thing that varies. The engine has to take them as input, not wrap them.

## Consequences

- A Piece is extracted only when a second Assembly uses it. The second Assembly is a minimal personal todo tracker in `examples/`. It has three statuses, no Apps or Projects, and no approve guard. The v0 postmortem's lesson 9 ("Policy is a 10-line object until a second project exists") is why this gate exists. A Piece with one user is a guess about what varies.
- ADR-0003 survives in a new place. The state machine stays code-owned and every edge still names its owner, but the code that owns it is the Assembly's. The Goblin Foundry lifecycle in ADR-0003 becomes the Goblin Foundry Assembly's definition.
- Reversed: PRODUCT.md's "not a design audience yet" (2026-09-03) for developers who build on the Pieces, and the BLUEPRINT-v1 §9 deferral of "configurable workflows, custom statuses … plugins" for the Pieces. ADR-0006's exclusion of custom statuses still holds for the Goblin Foundry Assembly.
- Extraction order: the workflow engine first, then history, archive and trash, dependencies, and atomic writes. The UI Pieces come next. The App, Project and Ticket hierarchy comes last, because it is built into the table columns and reaches 27 source files (`grep -rlE 'app_id|project_id' shared/src api/src cli/src web/src | grep -v test`).
- Open: whether each Assembly keeps one HTTP write path (ADR-0004), and what storage seam a Piece that owns tables is given (ADR-0001).
