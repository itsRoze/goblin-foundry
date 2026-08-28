---
status: accepted
date: 2026-08-27
---
# One global ticket sequence, opaque ids for everything else

Tickets are identified by a global serial integer, displayed as `<prefix>-<n>` (`GF-12`), with the prefix a single installation setting. Apps and projects are renamable and tickets may exist without either, so per-app keys (`SR-12`, Linear-style team keys) would either go stale on rename or be impossible for orphan tickets. Apps, projects and later milestones use opaque serial ids with mutable names. Numbers are never reused.

## Consequences

- Moving a ticket between apps or projects never changes its key.
- v0's per-project key derivation (51 lines of plpgsql) is not needed.
