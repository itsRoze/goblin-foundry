# mattpocock/skills — what the factory borrows

Source: https://github.com/mattpocock/skills (MIT), read 2026-08-25, 37 SKILL.md files.
The factory's tickets FAC-28…FAC-37 each cite one of these. This note is the map.

## Already ours

The planner is `grilling` (frontier, rounds, a recommended answer per question,
"finding facts is your job, never the user's" — verbatim in `apps/worker/prompts/planner.md`)
plus `to-spec`'s rules (no file paths, criteria that can be checked). `handoff` is
`BuildOutput.handoff`. `implement` is the sequencer. Nothing to import from any of these.

## Borrowed, by agent

| Skill | Ours | Ticket | What it adds |
|---|---|---|---|
| `code-review` (Spec axis) | reviewer, correctness lens | FAC-28 (M1) | (b) behaviour the design did not ask for, (c) implemented-but-wrong. We only check (a). |
| `tdd`, `to-spec` §Testing | design template, builder | FAC-29 (M1) | Test seams are a design decision: the planner names them, the builder tests only there. |
| `codebase-design` | planner engineering perspective, maintainability lens | FAC-30 (M1) | One vocabulary: module / interface / depth / seam / adapter / leverage / locality; the deletion test; one adapter = hypothetical seam. Shared reference, not a phase. |
| `diagnosing-bugs` | builder, `type=bug` | FAC-31 (M2) | Phase 1 is a tight, red-capable loop shown red; evidence gate re-runs it red→green. |
| `resolving-merge-conflicts` | `base_conflict` | FAC-32 (M2) | A bounded resolve phase before the human fallback. |
| `domain-modeling`, `writing-for-agents` | Librarian | FAC-33 (M2) | CONTEXT.md is a glossary only; an ADR needs all of hard-to-reverse / surprising / real trade-off. DECISIONS.md gets pruned through that test. |
| `improve-codebase-architecture` | Scout | FAC-34 (M2) | Hot spots from `git log`, deletion test, one proposal ticket per card with Strong / Worth exploring / Speculative. Ships as `/scout` first, cron second. |
| `to-tickets` | Conductor (FAC-15), FAC-19 | FAC-35 (M2) | Tracer-bullet slices become tickets with `ticket_dep` edges before build; expand → migrate → contract for wide refactors. The real fix for "build the next slice". |
| `wayfinder` | Conductor, milestone kickoffs | FAC-36 (M3) | A milestone as a map of decision tickets (research / prototype / grilling / task), fog of war, one decision per session. |
| `retro` (in-progress) | Scout | FAC-37 (M3) | Read run history for navigation, checks, reviewer rules, tool economy, no-ops, information access. |

## Read for ideas, no ticket

- `prototype/LOGIC.md` — a single-file state-machine walkthrough; a `review.html`
  shape for state-heavy tickets, if it can be done without `<script>`.
- `to-questionnaire` — "grill the send, not the subject": purpose and why-this-matters
  per question is a good shape for inbox rounds.
- `writing-for-agents` §Negation — our prompts are dense with "never"; prompt the
  positive and keep prohibitions only as hard guardrails.

## Skipped

`grill-me` / `grill-with-docs` (ours), `triage`, `setup-*`, `ask-matt`, `teach`,
`wait-what`, `wizard`, `research` (we give every agent WebFetch and keep notes here),
`misc/*`, and the rest of `in-progress/`.
