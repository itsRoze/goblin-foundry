# Uber AutoCover + uReview — mechanics of execution-as-oracle, mutation gate, and grade→filter→dedupe review

- **URL:** AutoCover paper (ICSE-SEIP '26) https://homes.cs.washington.edu/~rjust/publ/auto_cover_icse_2026.pdf ; uReview blog https://www.uber.com/us/en/blog/ureview/
- **Type:** blog / paper (validation mechanics). Architecture overview already in `research/blogs/uber-software-factory.md`; this file only goes deeper on the oracles and gates.
- **Author/Org:** Rastenis, Chou, Roy Choudhary (Uber), René Just (UW) — AutoCover; Uber Developer Platform — uReview (Aug 2025)
- **Researched:** 2026-08-26
- **Status/maturity:** Production at Uber (AutoCover GA Aug 2025, ~11% of all new reviewed tests; uReview >90% of ~65k weekly diffs). Nothing open source; LangGraph-based.

## One-paragraph summary

AutoCover's answer to "is this generated test any good?" is a chain of increasingly expensive oracles: it must **compile and run** in a Bazel sandbox, it must **add signal** (raise line coverage *or* satisfy a previously uncovered *scenario* from a Preparer-built scenario map), it must **survive a conventions registry** (machine-readable rules for hermetic IO, seeded randomness, no change-detector assertions), and it must **kill bounded mutants**; anything failing routes to a Fixer that only applies reversible, "do no harm" edits, with chronic non-improvers frozen. uReview's answer to "is this review comment worth a human's attention?" is likewise a chain: three specialised generators → a *second* model grades each comment with a confidence score → per-(assistant, language, category) thresholds tuned from developer votes → semantic dedupe → category suppression → post; "addressed" is measured automatically by re-running the reviewer 5× on the final commit. The lesson for a factory: don't ask one model "is this right?"; stack cheap deterministic oracles first and use a model only to rank/filter what survives.

## Core ideas / thesis

- **Viability is executable.** "A test case is viable only if it successfully executes and either raises code coverage or scenario coverage." Coverage ≠ effectiveness, hence scenario coverage + mutation.
- **Reject change-detectors.** Tests asserting internal details are "Bad — not landable"; the Validator rejects them structurally.
- **Validator as policy gate; Fixer as bounded repair.** "Executable, signal-adding tests enter quality checks; failing tests route to repair." Fixer patches "that degrade passing tests are reverted."
- **Determinism first.** Pinned toolchains, seeds, no global state; a stability cache returns prior findings for unchanged files "smoothing LLM variability across runs".
- **Precision over volume for review.** "Unfiltered outputs led to hallucinated issues"; the multi-stage chain, not prompt wording, made uReview trustworthy. Devs reject nits; accept correctness/error-handling findings.
- **Measure "addressed", not "posted".** Automated: re-run uReview 5× on the final commit and check the issue is gone ("the minimal count that virtually eliminates missed detections while keeping cost and latency low").

## Architecture & mechanics

### AutoCover pipeline (Preparer → Generator → Executor → Validator → Fixer)
1. **Preparer** — scenario discovery (per-function happy/edge scenarios + contract notes + invariants → *scenario map*); baseline build+coverage probe → prioritised *target map*; scaffold canonical test file, pre-seed imports/table skeletons; on initial build failure invoke Fixer first.
2. **Generator** — fan out per function guided by scenarios; "existing test extender" appends table rows / tightens assertions; full-file fallback when parsing fails; **already-tried dedupe** by normalised content in a shared versioned store.
3. **Executor** — artifact plan from the build graph (mocks/codegen materialised *before* generation); pipeline retrieve→splice→compile→run/coverage→validate with bounded queues; each candidate test replicated to its own Bazel target in an isolated sandbox with cache reuse; per-(function, scenario) coverage sets harvested; AST-aware splice keeps only tests that compile and add signal, reverts the rest; name/import conflicts resolved by deterministic rename/alias or re-queued to Fixer.
4. **Validator** (the gate) —
   - *Conventions*: LLM-powered best-practices registry, rules as `⟨id, severity, span, rationale, patch, confidence⟩` with language-scoped versioned examples (hermetic IO, seeded randomness, import aliasing); violations returned with context-matched examples.
   - *Mutation*: "bounded type and count of mutants. Surviving mutants are attributed to specific tests and scenarios, triggering prompts that guide input selection and tighten oracles."
   - *Lint*: adapters may skip execution for obvious violations; final lint on accepted tests, findings normalised with spans + suggested patches.
   - *Persistent memory*: stability cache per unchanged file; per-target run logs; policy suppression of repeated low-severity issues; knobs for re-validation rounds, severity thresholds, tool/token budgets.
5. **Fixer** — per-test-case parallel repair from diagnostics + Validator findings + scenario intent + edit history; prioritised by expected improvement; "chronic non-improvers are frozen after repeated failures"; bounded context crawler (`ls`, `tree`, `read_file`); policy-gated helper for build-file/import fixes; signed, auditable, reversible patches; successful patterns fed back into same-run prompts.

**Gate ordering in effect:** build → run → coverage-or-scenario delta → conventions → mutation → lint → splice. Cheap/deterministic first, LLM-judged conventions and mutation last, Fixer loops bounded by retries-per-test-case.

**Numbers:** viable-test success 20% Java / 40% Go / 80% Python; 44% explicit IDE acceptance; benchmark (9 Go subjects, 60-min budget) median coverage 93.2% at 10 min vs Claude Code 2.0.75 90.4% at 15 min and Cursor 2.3 96.7% only at 30 min; expert rubric (Very good / Good / OK landable; Bad / Very bad / Broken not) — AutoCover produced no Broken tests. Cache hit rates: Validator (IDE) 91.7%, Generator 53.5%, Fixer crawler 59.5%. Regression suite runs pre-merge / nightly canary / on-demand with signals: time-to-first-coverage, accepted-test count, scenario coverage, Validator pass rate, flakiness rate. Telemetry: mutation survivors per function, Validator pass/fail by rule, compute per accepted test.

### uReview pipeline (Commenter)
1. **Preprocess** — drop config/generated/experimental files; context = surrounding functions/classes/imports.
2. **Generate** — pluggable assistants, each with its own prompt/context: *Standard* (bugs, exception handling, logic), *Best Practices* (Uber conventions from the shared style registry), *AppSec*.
3. **Grade** — "A secondary prompt evaluates each comment's quality and assigns a confidence score." Best combo on the golden set: Claude-4-Sonnet generator + o4-mini-high grader (highest F1). Thresholds "set at a fine-grained level (per assistant, per language, and comment category) based on developer feedback."
4. **Dedupe** — semantic similarity filter merges overlapping suggestions.
5. **Suppress** — category classifier tags each comment; categories with historically low developer value (readability nits, minor logging, low-impact perf, style) are suppressed.
6. **Post + collect** — Useful/Not-useful votes streamed to Hive via Kafka.
7. **Evaluate** — automated "addressed" = re-run 5× on final commit; manual = curated benchmark of commits with known issues → precision/recall/F1. Results: 75% useful, 65% addressed (human comments: 51% judged bugs by author), median ~4 min, ~1,500 h/week saved. **Fixer** proposes code changes for human or AI comments (no mechanics published).

## Workflow: end to end

AutoCover Headless: shard repo → per target: Preparer probe → Generator fan-out → Executor sandboxes → Validator gate → Fixer loop (bounded) → splice → open merge request routed to owning team. CLI: same loop, local state. IDE: background precompute with the same gate, user accepts/rejects (44% accept).

## Notable techniques worth stealing

- **"Signal-adding" as the admission test**: keep a generated test only if it raises line coverage *or* covers a named scenario; otherwise revert. Pairs with a Preparer-style scenario map so scenario coverage is a first-class, listable oracle.
- **Bounded mutation with attribution**: cap mutant types/count per function; map survivors → test → scenario → targeted "tighten the oracle" prompt. (Not a global mutation score.)
- **Conventions registry as data** (`id, severity, span, rationale, patch, confidence` + examples) so both the LLM checker and the Fixer consume the same rules.
- **Stability cache** keyed by file hash to make LLM judgements idempotent across runs; per-target run logs to suppress repeat low-severity findings.
- **Do-no-harm Fixer**: reversible, signed patches; revert if passing tests degrade; freeze after N failures; priority by expected improvement.
- **Stable/semi-stable/volatile prompt blocks + pilot request** to warm prompt caches before fan-out.
- **Grader is a different model than the generator**; thresholds per (assistant, language, category); suppression list by category.
- **"Addressed" via re-run-N-times** on the final commit — an automatic, model-free-ish outcome metric for review quality.
- **Golden set + F1** to pick generator/grader pairs; re-run when models change.
- **E2E regression suite for the agent pipeline itself** (pre-merge, nightly canary, on-demand after incidents) with SLOs and one-click rollback of prompt/agent configs.

## Weaknesses / open questions / risks

- Mutation details are thin: which operators, how many mutants, what threshold — "bounded" only.
- Conventions checking is LLM-powered; variability is patched by caching rather than removed.
- Viable-test rate is low for Java (20%); users report style drift, bloat, slowness, ignoring local idioms.
- uReview is code-only (no design/architecture context); Fixer unquantified; per-category thresholds require a feedback firehose a solo dev doesn't have.
- All infra assumes Bazel monorepo + LLM gateway + Kafka; none of it is open.

## Fit for our agentic stack (pi, cloud VMs, open source)

- **Adopt the admission test for agent-written tests**: in the factory's `verify` step, compute diff coverage before/after the agent's test changes (`diff-cover`, `nyc`/`c8`, `go tool cover`) and a scenario checklist from the task spec; tests that add neither are flagged for deletion. Cheap, deterministic, runs in the VM.
- **Adopt bounded, attributed mutation** on changed files only (Stryker `--incremental --mutate <changed files>`; mutmut on changed paths; gremlins/mutate4go per file) and feed survivors back to the *same* worker as "write a test that fails under this mutant" — the AutoCover prompt pattern.
- **Adapt the review chain** as a pi extension / GitHub Action: Sonnet-class generator → cheap grader (different vendor) → dedupe → repo-level `review-suppress.yaml` categories → post only ≥ threshold. Start with one global threshold and a 30–50 PR golden set; per-category tuning needs volume you won't have.
- **Adopt "addressed" measurement**: re-run the reviewer on the final commit (3× is enough at our scale) and log resolved/unresolved per category.
- **Adopt do-no-harm repair rules** in the worker prompt/extension: revert if the baseline suite regresses; max 2–3 repair rounds per failing check; freeze and escalate.
- **Skip** LangGraph, Bazel per-test target fan-out, Kafka feedback plumbing.

## Related resources mentioned

- LangChain Interrupt 2025 talk on Uber Validator/AutoCover — https://www.youtube.com/watch?v=Bugs0dVcNI8
- René Just's mutation-testing work (Defects4J, Major) — background for "bounded mutants"; not fetched.
- uReview 5×-rerun "addressed" methodology — reusable for any review agent.

## Key quotes / references

> "Validator rejects change-detector tests and enforces best practices (stable oracles, isolation, table-driven structure), admitting tests that raise line coverage or satisfy previously uncovered scenarios."
> "Surviving mutants are attributed to specific tests and scenarios, triggering prompts that guide input selection and tighten oracles."
> "Fixer enforces a 'do no harm' policy: patches that degrade passing tests are reverted. All patches are signed and auditable."
> "A secondary prompt evaluates each comment's quality and assigns a confidence score… thresholds set… per assistant, per language, and comment category."
> uReview: addressed = "re-running uReview five times on the final commit… the minimal count that virtually eliminates missed detections while keeping cost and latency low."
