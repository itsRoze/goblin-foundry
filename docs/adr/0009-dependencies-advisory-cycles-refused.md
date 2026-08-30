---
status: accepted
date: 2026-08-30
---
# Dependencies are advisory edges; cycles are refused at write time

Linear, Jira and GitHub all treat blocking relations as pure metadata: nothing gates a transition, and none of them documents any cycle prevention (research: Linear's docs demote a resolved blocker to "Related" and paint violated project dependencies red rather than stopping anything; Jira ships enforcement only via add-ons; GitHub's 2025 issue dependencies are likewise informational). We keep the advisory half — blockedness never forbids a Transition; the sole friction is a confirm dialog on `start` of a blocked ticket — but deviate on cycles, because our edges are load-bearing where theirs are decoration: they derive `GET /frontier`, which an automated controller (S5) will drain. A cycle makes every ticket in it permanently blocked, so the frontier starves silently with no actor to blame. Refusing the insert (`409` with a one-line hint) is the only moment a human is present to be told.

The check walks **all** stored edges regardless of status, not just open ones: statuses change (`reopen`, restore from trash), and a cycle that only materialises when a done ticket is reopened would surface at a moment nobody is thinking about dependencies. For the same reason edges are durable facts, not live constraints — an edge may point at an already-`done`/`cancelled` blocker (inert unless it reopens) and survives a trip through the Trash (a trashed blocker stops blocking; restore re-blocks).

## Consequences

- The frontier can never deadlock; no cycle-breaking UI or detection job is ever needed.
- The transition table (ADR-0003) stays ignorant of dependencies; ticket 05 adds no edges to it.
- The insert-time walk must traverse the dependency table through the db seam (iterative selects, ADR-0001) — acceptable at solo-factory scale, and the place to revisit if the graph ever gets big enough to hurt.
