# Uncle Bob's machine-checked quality gate: Acceptance-Pipeline-Specification + mutate4go / crap4go / dry4go / clj-mutate / scrap ("Clean AI: Agentic Discipline")

- **URL:** https://github.com/unclebob/Acceptance-Pipeline-Specification ; https://github.com/unclebob/mutate4go ; https://github.com/unclebob/crap4go ; https://github.com/unclebob/dry4go ; https://github.com/unclebob/clj-mutate ; https://github.com/unclebob/scrap ; https://github.com/unclebob/dependency-checker ; https://github.com/unclebob/arch-view ; series https://cleancoders.com/series/clean-ai/agentic-discipline
- **Type:** skills/agents (quality tooling) + blog/video series
- **Author/Org:** Robert C. Martin (with Justin Martin for the video series)
- **Researched:** 2026-08-26
- **Status/maturity:** All repos are 2026, single-author, actively pushed (APS 176 stars, last push 2026-08-20; mutate4go 18★ 2026-05-23; crap4go 20★ 2026-05-21; dry4go 24★ 2026-05-11; clj-mutate 28★ 2026-06-17; crap4java 298★; scrap 21★). **Licensing is a blocker: every README says "Copyright (c) Robert C. Martin. All rights reserved." and GitHub shows no LICENSE** (APS included). swarm-forge (same author, see `research/factories/swarm-forge.md`) has the same problem. Series episodes: Ep4 "Agentic Discipline" 2026-04-03 ("four months of intense research… testing and BDD, coverage, mutation testing, debugging, performance, management strategies"); Ep5 2026-05-14 builds the first Swarm Forge (Architect/Integrator/Coder). Uncle Bob's 2026-07-24 tweet lists the toolset: swarm-forge, crap4java/clj/go, Acceptance-Pipeline-Specification, arch-view, dry4clj/go/java, clj-mutate, mutate4java/go, scrap, dependency-checker, speclj-structure-check, AIR-J, Pharaoh, gospringies….

## One-paragraph summary

Uncle Bob's stated policy is that he **does not read the code his agents write**; instead he "surrounds the agents with extreme constraints: unit tests, gherkin tests, QA procedures, quality metrics, mutation testing, test coverage, and a plethora of others" and trusts what passes. The repos are the concrete gate: (1) **APS** — a language-neutral spec (with Babashka + Go reference tools) that turns Gherkin feature files into JSON IR, generates executable acceptance entry points, and then *mutates the example data in the spec* to prove the acceptance tests are actually wired to the application; (2) **mutate4go / clj-mutate / mutate4java** — file-at-a-time source mutation testers with coverage-aware skipping, differential re-runs via an embedded footer manifest, and a "no survivors, no uncovered sites before moving to the next file" workflow written for agents; (3) **crap4go/java/clj** — CRAP = CC²·(1-cov)³ + CC per function; (4) **dry4go/clj/java** — AST-fingerprint Jaccard duplicate detection (default threshold 0.82); (5) **scrap** — structural quality of the *test* code; (6) **dependency-checker / arch-view** — component-boundary and cycle checks. Each ships a `SKILL.md` for Claude Code, i.e. they are designed to be run by the agent in its loop, not by a human after the fact.

## Core ideas / thesis

- **Don't read, constrain.** "Not reading any of the code written by his agents — that's the only way he can take advantage of their productivity." Verification is outsourced to deterministic tools; the human reads reports and metrics.
- **Two kinds of mutation.** *Source* mutation (mutate4go) proves unit tests have teeth. *Acceptance* mutation (APS) proves Gherkin examples reach the app: "The normal run proves that the project satisfies the feature. The mutation run checks whether the acceptance tests fail when important example values change." Both are exit-code gates (APS mutator: `0` all killed, `1` any survived/error, `2` usage).
- **One file at a time, to zero.** mutate4go/clj-mutate recommended loop: "Only start the next file when the current file has no uncovered mutations and no survivors." Survivors are *bugs in the tests*, not stats to trend.
- **Metrics for the test code too** (SCRAP), because agents write bloated tests as readily as bloated code.
- **Size pressure via mutation count.** `--mutation-warning 50`: "If a changed file reports more than 50 mutation sites, consider splitting it before doing full mutation work."
- **Skills are the delivery vehicle.** Every tool has a `SKILL.md` so the agent knows *when* to run it ("Use when mutation-testing Go code, assessing test quality beyond coverage, or investigating surviving mutations").

## Architecture & mechanics

### Acceptance-Pipeline-Specification (APS)
Normal run: `feature file → gherkin parser → JSON IR → (IR-DRY checker) → acceptance entrypoint generator → generated tests → project test runner`.
Mutation run: `feature → parser → base IR → generator (once) → gherkin mutator → runner adapter evaluates each mutated IR → report`.

Portable tools (`bb.edn` tasks; Go fallbacks in `cmd/`):
```sh
bb gherkin-parser <feature-file> <json-output>
bb gherkin-ir-dry-checker [--include-exact] <json-ir> <report-output>   # advisory: duplicate-in-scenario, placeholder-variant, near-duplicate, possible-synonym
bb gherkin-mutator --feature features/x.feature --runner-worker "<cmd>" --workers 4 --timeout 300s --level hard [--json]
```
Project-specific pieces the agent writes: entrypoint generator, runtime, step handlers, **runner adapter** (persistent worker, NDJSON over stdin/stdout: `{id, feature_json, generated_dir, work_dir, timeout}` → `{id, outcome: test_success|test_failure|infrastructure_error, output, error, duration}`), convenience scripts. Paths: `features/`, `build/acceptance/`, `build/acceptance-mutation/{base,generated,mutations/mN}/`, `acceptance/generated/`.

Mutation rules (one example cell per mutation, deterministic pseudo-random): comma lists → mutate one item; `true/false` flip; `null/nil/none` → dithered string; ints ± nonzero delta; floats ± delta; ISO dates/times shift; durations shift; else dither string by one edit. Never mutates step text, keywords, backgrounds, headers, or source. Classification: `test_failure → killed`, `test_success → survived`, `infrastructure_error → error`. Differential levels `full | hard (default) | soft` keyed on a feature stamp (`# mutation-stamp: sha256=…`) and a per-scenario manifest comment block (background hash, scenario hash, implementation hash, last result); a scenario is skipped only if its last run had zero survivors and zero errors. Report: `total=… killed=… survived=… errors=…` then `<status> <path>: <orig> -> <mutated>`.

### mutate4go (clj-mutate / mutate4java are the same design)
```bash
go install github.com/unclebob/mutate4go/cmd/mutate4go@latest
go test ./...
mutate4go internal/foo/foo.go --scan            # sites, changed sites, size warning; no tests run
mutate4go internal/foo/foo.go --max-workers 3   # differential by default if footer manifest exists
mutate4go internal/foo/foo.go --lines 45,67     # retest survivors
mutate4go internal/foo/foo.go --mutate-all | --since-last-run | --reuse-coverage | --timeout-factor 15 | --test-command "go test ./internal/foo" | --mutation-warning 75
```
Operators: `+↔-`, `*→/`, `>↔>=`, `<↔<=`, `==↔!=`, `true↔false`, `&&↔||`, `0↔1`. Coverage from `target/coverage/coverage.out`; uncovered sites are reported, not executed. Timeout = killed ("behaviour changed"). A **footer manifest embedded in the source file** records `tested_at` + per-function hash so re-runs are differential. clj-mutate adds `:no-mutate` spec tag so mutation workers don't recurse, and recommends `clj -M:scrap spec` before mutating.

### crap4go
`crap4go` (deletes stale coverage, runs `go test ./... -coverprofile=target/coverage/coverage.out`, analyses). `CRAP = CC² × (1 − cov)³ + CC`; bands 1–5 clean, 5–30 moderate, 30+ crappy. CC counts `if/for/range/switch cases/select clauses/&&/||`. `--test-command "…{coverprofile}…"`, `--max-workers`, path-fragment filters. Skill installable via `.claude/settings.json` `skills: ["https://github.com/unclebob/crap4go/blob/master/SKILL.md"]`.

### dry4go
`dry4go --threshold 0.82 --min-lines 4 --min-nodes 20 --json .` — normalises identifiers/literals, keeps structure, Jaccard over structural fingerprints, reports `DUPLICATE score=0.89 file:a-b file:c-d`. Report-only "so another mechanism can evaluate and reduce duplication".

### scrap / dependency-checker / arch-view
`clj -M:scrap spec [--json|--write-baseline|--compare target/scrap/spec.json]` — per-example line count, structural complexity, assertion count, branch count, setup depth, `with-redefs` count, helper-hidden lines; flags nested `it`/`describe` errors; "recommendations, not directives". `dependency-checker.edn` declares components; `clj -M:check-dependencies` reports boundary violations and cycles. arch-view renders layered namespace graph with cycles in red.

## Workflow: end to end (as the tools/skills prescribe)

1. Write Gherkin features for real behaviour → `bb gherkin-parser` → `bb gherkin-ir-dry-checker` → prune wording drift.
2. Generate entry points, implement step handlers/runtime; add normal acceptance script to regular verification.
3. Unit-test + implement (TDD per swarm-forge constitution).
4. `go test ./...` → `crap4go` (look at top of table) → `dry4go .` (review candidates) → `mutate4go <changed file> --scan` (split if >50 sites) → `mutate4go <file> --max-workers 3` → kill survivors/cover uncovered → next file.
5. Periodically (not per commit): `bb gherkin-mutator … --level hard` on acceptance features; exit 1 blocks.
6. Dependency/architecture check; SCRAP on spec tree; human reads reports.

## Notable techniques worth stealing

- **Acceptance-data mutation** — cheap, language-neutral proof that end-to-end tests are connected (catches "test asserts on the fixture, not the app"). Mutating spec *values* rather than code sidesteps equivalent-mutant noise.
- **Persistent runner-worker protocol** (NDJSON, stays hot) — the right shape for a mutation gate in a VM: start once, feed hundreds of jobs.
- **Embedded footer manifest / stamp for differential mutation** — mutation cost becomes proportional to what changed; no external state store.
- **`--scan` as a size smell** — mutation-site count as a structural pressure signal before spending compute.
- **Zero-survivor per-file discipline** for agents, instead of a global percentage the agent can game by adding easy code.
- **CRAP on new/changed functions** as the ranking for "what to test next".
- **Test-code metrics (SCRAP)** — agents' tests need linting for structure too.
- **SKILL.md-per-tool** distribution — trivially portable to pi skills.

## Weaknesses / open questions / risks

- **No licence** on any repo; cannot be vendored into an open-source factory as-is. Go binaries could be built and invoked as external tools, but redistribution is unclear. Ask, or reimplement the (small) specs.
- Go/Clojure/Java only; nothing for TypeScript/Python (Stryker/mutmut fill the gap, see landscape).
- Mutation operators are a minimal set (no statement deletion, no return-value mutation, no boundary on slices); acceptable for a gate, weaker than Stryker/PIT.
- Single-file at a time is slow across a large diff; needs an orchestrator to pick files from `git diff`.
- The spec is heavy (four spec docs) and the project-specific half is written by the agent each time; risk of subtle non-conformance.
- Evidence of efficacy is anecdotal (his own Clojure/Go projects); no published numbers.

## Fit for our agentic stack (pi, cloud VMs, open source)

- **Adopt the ordering and the zero-survivor rule**, not the binaries: `typecheck/lint → unit tests → diff coverage → CRAP-on-changed-functions → dup check → differential mutation on changed files (0 survivors, 0 uncovered) → acceptance suite → acceptance-data mutation (nightly)`. Encode as a `make verify`-style script the pi worker must run before handoff, plus a `tool_call` extension that blocks `git commit`/handoff until the last verify hash matches HEAD (cf. imti.co pre-commit review gate).
- **Adapt APS as a spec, reimplement minimal tooling** in TS/Python if licensing stays unresolved: Gherkin→JSON IR + example-value mutator is ~500 lines; the runner-worker protocol is worth keeping verbatim.
- **Port SKILL.md files to pi skills** for Stryker/mutmut/gremlins with the same workflow text ("survived → write a test that fails with the mutation").
- **Skip** SCRAP/arch-view/dependency-checker (Clojure-specific); use `dependency-cruiser` (TS) / `import-linter` (Py) / `go-arch-lint` instead.
- **Cost note:** mutation in a cloud VM is CPU-bound and parallel (`--max-workers`, Stryker `--concurrency`); budget it as a nightly or pre-merge step, not per tool-call.

## Related resources mentioned

- swarm-forge — already covered in `research/factories/swarm-forge.md` (constitution requires Gherkin acceptance tests that are themselves mutation-tested).
- imti.co "AI on a Leash" Go config + "Pre-Commit Review Gate" — https://imti.co/go-ai-verified-development/ , https://imti.co/pre-commit-review-gate/ — `make verify` = lint test coverage patch-coverage security deadcode build-check; gremlins `--threshold-efficacy 60`; 80% patch coverage; PreToolUse hook denies `git commit` without a fresh review artifact.
- Medium: "Uncle Bob stopped reading his agents' code" — https://medium.com/@ivan-stepantsov/uncle-bob-stopped-reading-his-agents-code-8c8544b16b39 (SonarQube "Sonar way" new-code gate: 0 new issues, ≥80% new-code coverage, ≤3% new-code duplication).
- O'Reilly live event "AI Agents for Clean Code with Uncle Bob" — https://www.oreilly.com/live-events/ai-agents-for-clean-code-with-uncle-bob-martin/0642572376765/

## Key quotes / references

> "Copyright (c) Robert C. Martin. All rights reserved." — every README.
> "Acceptance mutation means mutating Gherkin example values in the specification-derived JSON IR. It does not mean conventional mutation testing of application source code."
> "Only start the next file when the current file has no uncovered mutations and no survivors."
> "Do not blindly merge steps only because they look similar."
> "The output is a set of recommendations, not directives. An AI assistant should treat SCRAP as decision support."
