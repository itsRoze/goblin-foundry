# Cognition FrontierCode eval + Devin Fusion

- **URL:** https://cognition.com/blog/frontier-code ; Devin Fusion https://cognition.com/blog/devin-fusion (announced 2026-06-29; updated numbers 2026-08-07) ; https://x.com/cognition/status/2071624568465490170
- **Type:** blog (benchmark + harness product)
- **Author/Org:** Cognition (Devin)
- **Researched:** 2026-08-26
- **Status/maturity:** FrontierCode 1.1: 150 tasks (Extended), 100 (Main), 50 (Diamond); 36 repos, 20+ maintainers, 40+ h per task; "unsaturated." Fusion in preview inside Devin.

## One-paragraph summary

FrontierCode is Cognition's attempt to benchmark *mergeability* rather than test-pass: each task has a maintainer-written rubric across behavioral correctness, regression safety, mechanical cleanliness, test correctness, scope discipline and code quality, with "blocker" criteria that zero the score. Novel graders include reverse-classical tests (agent-written tests must fail on the pre-patch code), automated scope checks (file boundaries, diff size, semantic locality), and `mutagent` (LLM-patched test environments so deterministic tests still run against open-ended solutions). Frontier models score 13% (Diamond) to ~52–65% (Extended). Devin Fusion is a two-agent harness (frontier "main agent" that delegates and decides, cheap "sidekick" that reads/executes) that keeps Extended score within ~2 points of Fable 5 at 1/8 the cost. Dex cites FrontierCode as one of the evals to watch for maintainability signal.

## Core ideas / thesis

- "Correct" is not "mergeable"; quality has to be encoded by humans with taste ("years of judgment about what makes code high-quality and worthy of merging" — Claudio Costa, Mattermost).
- Difficulty via rubric, not patch size: patches are smaller than DeepSWE's yet tasks are harder.
- Prompts are short and human-like (~1/3 the length of other benchmarks) plus a generic AGENTS.md-style guideline.
- False positives matter: 81% lower FP rate than SWE-Bench Pro.
- Fusion: "The age of using one model for all of your work is coming to an end"; "the main agent should take minimal actions, and only read what is absolutely necessary. By default it should delegate and monitor, while making the significant decisions."

## Architecture & mechanics

**Grading pipeline per task**
- Classical tests: injected hidden test files; exit codes for build/lint/regressions.
- Reverse-classical: the agent's submitted tests are run against the *original* code and must fail.
- Code scope: automated file-boundary, diff-size and semantic-locality checks; unrelated refactors penalized.
- Adaptive classical (`mutagent`): an LLM surgically patches the test harness to match the solution's implementation details, then runs deterministic tests.
- Rubric: blockers (correctness, performance, scope) -> score 0 if any fails; non-blockers (style, type safety, readability) reduce score.
**Task QC pipeline:** design (maintainer audits rubric) -> hack report (contributors and Devin try to game the rubric) -> calibration (four reference solutions spanning 0–100%) -> multi-stage review -> re-review.
**Results (1.0):** Diamond: Opus 4.8 13.4%, GPT-5.5 6.3% (4x fewer tokens), Gemini 3.1 Pro 4.7%, Kimi K2.6 3.8%. Main: Opus 4.8 34.3%, Kimi 16%. Extended: Opus 4.8 51.8%, Kimi 37%.
**Results (1.1 Extended, Fusion post):** Fable 5 xhigh 64.9 @ $10.53/task; Opus 5 medium 63.6 @ $3.51; Devin Fusion 63.1 @ $1.35; GPT-5.6 Sol high 58.7 @ $3.41.

**Devin Fusion harness**
- Two parallel agents, each with its own tools and persistent cached context; main agent delegates chunks to the sidekick and monitors.
- Lightweight classifiers watch progress and trigger model switches; switching happens "during context compaction, which would trigger a cache miss anyway" so it is cache-free.
- Claims: up to 60% cheaper at frontier-level quality; 41% cheaper when Fable 5 is the main model; 88% of internal merged PRs were router-driven.

## Workflow: end to end (as an eval)

Task prompt + guidelines -> agent works in repo -> submission = diff + tests -> mechanical gates (build/lint/regress) -> reverse-classical test check -> scope check -> mutagent-adapted hidden tests -> rubric judge -> blocker gate -> score.

## Notable techniques worth stealing

- Reverse-classical test gate: any agent-written test must fail on `git stash`/pre-patch tree — cheap, deterministic, catches vacuous tests.
- Scope discipline as a hard gate: max files, max diff size, locality to the issue.
- Blocker vs non-blocker rubric with score-zero semantics for review agents.
- Rubric calibration with reference solutions at 0/33/66/100%.
- "Hack report": red-team your own gates with the agent before trusting them.
- Fusion pattern: expensive planner/decider + cheap executor with separate caches; switch models at compaction boundaries.

## Weaknesses / open questions / risks

- Rubric judging still uses an LLM for quality dimensions — the ceiling problem Dex raises applies.
- Single-PR tasks; long-horizon maintainability (months) not measured, though Dex calls it "multi-PR" — verify.
- Cognition benchmarks its own product; Fusion numbers are self-reported.
- Task set is small (150) and partly private.

## Fit for our agentic stack (solo, pi, cloud VMs)

- **Adopt** as CI gates in our pipeline: (1) reverse-classical test step; (2) scope check (files touched vs issue's declared scope, diff-size budget); (3) rubric with blockers for the review agent, in `docs/review-rubric.md`.
- **Adapt Fusion cheaply:** pi main session on a frontier model that spawns pi subagent(s) on a cheap model for reads/greps/tests; hand off at compaction. Measure $/merged PR.
- **Use FrontierCode-style scoring** on our own merged PRs (sampled weekly) as the maintainability KPI Dex says nobody has.
- **Skip** mutagent-style test adaptation (overkill for one repo).

## Related resources mentioned

- SWE-Bench Pro, DeepSWE (contrast benchmarks); SWE-Marathon (per Dex)
- `mutagent` tool (not public as far as found)
- eesel.ai Fusion explainers (secondary)

## Key quotes / references

- "FrontierCode's unique value comes from the human experience encoded in its evals." — Claudio Costa
- "Engineering teams are lighting money on fire. It's no longer sustainable to use the most expensive models on every task."
- "Devin maintains frontier and Fable 5-level performance at 60% lower cost on FrontierCode."

## Gaps

- Did not confirm whether tasks are multi-PR (Dex says so; the page summary reads single-PR). Exact judge-model and rubric weights not captured. Whether `mutagent` or the task set is open-sourced not verified.
