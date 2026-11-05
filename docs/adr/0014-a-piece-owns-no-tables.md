---
status: accepted
date: 2026-11-04
amends: ADR-0011
---
# A Piece owns no tables; it is handed a store

ADR-0011 left open what storage seam a Piece that owns tables is given. `@goblin/history` is the first Piece that has to read and write stored records, and the answer is that it owns no table. It holds the algorithm and is handed a store: a small port the Assembly implements, whose writes are the Assembly's own write type. Goblin Foundry implements it in Drizzle and commits the returned write in the same `atomically` batch as the row it records. `examples/todo` implements it over in-memory arrays.

## Considered options

- **A pure Piece that only decides, like `@goblin/workflow` and `@goblin/labels`.** Rejected. Every Assembly would write its own session rule, merge and read order, so the Piece would not record or read anything, and nothing would stop an Assembly skipping the rule.
- **A Piece that owns a Drizzle table and takes a `Db`.** Rejected. The Piece would depend on Drizzle, a minimal in-memory Assembly would have to adopt SQLite, and `atomically` would have to move ahead of atomic writes' own turn in ADR-0011's extraction order.

## Consequences

- The schema, its migrations and the driver stay with the Assembly, and ADR-0001's single `db.ts` seam is unchanged. No Piece imports a driver or Drizzle.
- A Piece never opens a transaction. Whether a change and its record commit together is the Assembly's guarantee, so a store's contract has to say what its writes promise, and a Piece's own tests do not prove atomicity. Goblin Foundry's API tests do.
- A port method is async where any Assembly's read is, so an in-memory Assembly's calls become async too.
- The rules that belong to the Piece, such as what joins two writes, the merge and the read order, live in one place. A store runs the session lookup it is handed, so its contract has to say to match the whole key. The read order does not depend on the store at all.
