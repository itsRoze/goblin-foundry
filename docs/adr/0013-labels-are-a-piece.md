---
status: accepted
date: 2026-10-30
amends: ADR-0006
---
# Labels are a Piece; Goblin Foundry's vocabulary is open

ADR-0006 left labels out of S1. ADR-0012 then made Goblin Foundry host several workflows, and two of them need a kind on a Ticket that is not its Status: wayfinder's decision types (`research`, `prototype`, `grilling`, `task`) and the two triage roles the Status cannot carry (`needs-info`, `ready-for-human`), which became meaningful once an agent may approve. A title prefix or a `Triage:` line would be a shadow field the tracker cannot filter on.

Labels are built as a Piece, `@goblin/labels`, not inside the Goblin Foundry Assembly. `examples/todo` adopts them in the same change, so the Piece has its second Assembly from the start (ADR-0011's gate). The Piece owns name normalisation (trimmed, lower-case, `:` allowed as part of a name) and matching; it takes as rules a `vocabulary`, either `'open'` (a name is created by first use) or a fixed list, and an optional per-Ticket limit. Goblin Foundry is open with no limit; todo is a fixed list.

## Considered options

- **Build labels in the Assembly and extract later.** Rejected: labels are a primitive other Assemblies will want, and the fixed-vs-open vocabulary is a real difference between the two Assemblies today.
- **A single `kind` field.** Rejected: triage roles and wayfinder types are independent, and one Ticket can need both.

## Consequences

- The Piece is pure, like `@goblin/workflow`: rules and matching only. Each Assembly stores labels its own way (Goblin Foundry in a table, todo on the in-memory item), so ADR-0011's open question of a table-owning Piece's storage seam stays open.
- Labels apply to Tickets only. A card shows them as plain text chips; the board's Filter gains an any-of `label` set in the address, and `goblin ticket list` gains `--label`.
- Triage keeps `needs-triage`, `ready-for-agent` and `wontfix` as Statuses and gains `needs-info` and `ready-for-human` as labels; `docs/agents/triage-labels.md` changes with it.
- Until labels ship, wayfinder writes its type as a title prefix (`[research]`).
