# Decisions

Append-only. One line per decision, with why. Decisions locked before the build
started live in `docs/plan/factory-blueprint.html`; this file records what the
build itself decided.

- 2026-08-19 — M0 branch is `m0/thin-slice`, conventional commits. Why: kickoff agreement.
- 2026-08-19 — Postgres 17-alpine in docker on port 6432; Zero's `zero_cvr`/`zero_change` are separate databases in the same instance. Why: one container to run, no clash with a system Postgres on 5432.
- 2026-08-19 — zero-cache runs from the workspace (`just zero`), not docker-compose. Why: it needs the compiled Zero schema from `packages/schema`; mounting build output into a container buys nothing on a single dev box.
