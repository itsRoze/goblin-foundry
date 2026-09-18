---
status: accepted
date: 2026-09-16
---
# Bulk Ticket actions commit all or none

A Selection expresses one action on a set of Tickets, so every bulk transition, membership move, and trash operation succeeds for the whole submitted set or changes nothing. Server batch operations must validate the entire set and commit its Ticket changes and individual history events within one atomic storage operation; errors identify the Tickets preventing the action while leaving the whole set unchanged.

This replaces issue 03b's earlier choice of N independent requests and partial success. Client preflight cannot prevent a later request failing after earlier requests commit, and compensating requests cannot guarantee restoration. The added API and transaction support is the cost of the chosen all-or-none behavior; existing lifecycle and actor authority remain unchanged.

ADR-0001's sequential-statement approach is insufficient for these operations. Implementation must provide a genuine atomic boundary behind the existing database seam and verify rollback, including event-write failure, without assuming Drizzle's transaction wrapper works across drivers. This is a scoped requirement for bulk operations, not a change of database or a claim that the boundary already exists.
