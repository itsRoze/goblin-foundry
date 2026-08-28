# Zed DeltaDB — data model only

- **URL:** https://zed.dev/blog/introducing-deltadb (2026-06-11), https://zed.dev/blog/sequoia-backs-zed (2025-08), https://zed.dev/blog/introducing-delta (2026-08-12); HN 49187256
- **Type:** VCS data layer (closed, private beta)
- **Author/Org:** Zed Industries
- **Researched:** 2026-08-26 (supplements zed-delta.md; nothing new published since — no schema, API, or format post exists as of today)
- **Status/maturity:** Private beta; Zed said in 2025 it would "build it, open-source it, and offer an optional paid service" — not yet open-sourced; no repo.

## What is public about the data model (all of it)

- **Unit:** a *delta* = one fine-grained edit operation (character-level), with a **stable identity**. "Where Git captures a snapshot at each commit, DeltaDB captures every operation in between and gives each one a stable identity."
- **Log:** a stream of deltas per worktree; messages (human/agent prompts, reasoning, tool calls) are entries *in the same stream*: "A message and the edit it produced are recorded side by side, so neither drifts away from the other."
- **Replication:** operation-based CRDTs (Zed's existing collaborative-buffer engine lineage); "conflict-free replicated worktrees" — the whole worktree, not just open buffers, is a CRDT replica, and many people/agents can edit concurrently across machines.
- **Addressing:** any delta ID resolves to "the code at any moment in its evolution"; references (comments, links) are anchored to deltas, not line numbers, so they survive rewrites — "character-level permalinks that survive any code transformation".
- **Branching/rewind:** claimed instantaneous branching at any delta and rewind to any operation (virtual worktree); mechanism unpublished.
- **Git mapping:** deltas live *between* commits on your existing repo; commit/push unchanged; git remains "for running checks and connecting you to the rest of the world". How a commit is materialized from a delta range, and whether the delta log references commit SHAs, is undocumented.
- **Materialization:** files are real for agents (terminal in the worktree); a worktree can be mounted to disk on demand.
- **Storage/hosting:** hosted by Zed for the beta; retention, export, self-host: unpublished.

## Emulation in plain git + pi session (what we can build today)

| DeltaDB concept | Our equivalent |
|---|---|
| delta with stable id | jj operation id (per tool call via `jj util snapshot`) or `refs/factory/<session>/<n>` tree |
| message ↔ edit adjacency | pi session entry `{type:"custom", data:{op_id, tool_call_id}}` appended in the `tool_result` hook; pi entries already have ids + parentId |
| delta-anchored comment | `{commit, path, hunk-hash}` + `git blame`-based re-anchoring |
| rewind to any delta | `jj op restore <op>` + `pi --fork <entry>` |
| agents query history | give the agent `jj op log`/`jj log -p` + `pi` session export as tools |

## Gaps

- No schema, wire format, or CRDT specifics published; no API/CLI; nothing to integrate with. Re-check if Zed open-sources DeltaDB as promised.
