# Validation landscape — oracle types, tools, thresholds, and where they sit in an agent loop

- **URL:** (synthesis) key sources: Stryker https://stryker-mutator.io/docs/stryker-js/incremental/ ; mutmut https://mutmut.readthedocs.io/ ; gremlins https://github.com/go-gremlins/gremlins ; go-mutesting https://github.com/avito-tech/go-mutesting ; diff-cover https://github.com/Bachmann1234/diff_cover ; SWE Atlas https://arxiv.org/abs/2605.08366 ; "All Smoke, No Alarm" https://arxiv.org/abs/2606.18168 ; Anthropic agentic PBT https://www.anthropic.com/research/property-based-testing (paper https://arxiv.org/abs/2510.09907) ; Cognition "Verifying Agentic Development at Scale" https://cognition.com/blog/testing-development ; ECLoop https://arxiv.org/abs/2607.28815 ; BSG-VA https://arxiv.org/abs/2607.28871 ; imti.co "AI on a Leash" https://imti.co/go-ai-verified-development/ ; Trail of Bits mutation-testing skill https://github.com/trailofbits/skills
- **Type:** landscape / synthesis
- **Researched:** 2026-08-26
- **Status/maturity:** Tooling is mature (Stryker, mutmut, diff-cover, Playwright) ; research on *agent-specific* oracles is 2026-fresh (SWE Atlas May, All-Smoke Jun, ECLoop/BSG-VA Jul).

## One-paragraph summary

"Definition of done" for agent output is a *stack* of oracles, ordered by cost and by how hard they are to fool. Deterministic, model-free checks (build, typecheck, lint, tests, diff coverage, mutation, architecture rules, screenshot diff) go first and are the only ones allowed to *block*; model-based graders (LLM review, rubric judges) rank and filter what survives; black-box held-out evals (SlopCodeBench-style) judge the *harness*, not the PR. Three 2026 findings sharpen this: 80% of agent-authored test patches carry weak or no oracle signal (All Smoke, No Alarm), ~24% of "successful" repair rollouts rest entirely on non-bug-discriminating test evidence (BSG-VA), and agents pass coarse mutation checks far more often than rigorous rubric checks (SWE Atlas) — so the gate must check *that the tests can fail*, not just that they pass.

## Oracle table

| Oracle | What it proves | Fooled by | Cost / latency | Strength | Where in loop | Tools (TS / Py / Go) | Gate threshold (starting point) |
|---|---|---|---|---|---|---|---|
| Build + typecheck | Code is well-formed, types agree | Casts, `any`, `# type: ignore` | seconds | necessary, weak | every tool-call batch / pre-commit | `tsc --noEmit`, `pyright`/`mypy --strict`, `go vet` | 0 errors; lint rule against `as any` / `type: ignore` growth |
| Lint + formatting + complexity | Style, dead code, CC, function length | Splitting into trivial wrappers (SCB shows models do this) | seconds | weak | pre-commit | `eslint` + `eslint-plugin-sonarjs` (cognitive complexity), `ruff` (+`C901`), `radon cc`, `golangci-lint` (gocyclo≤10, gocognit≤15, funlen≤80, errcode=1) | 0 new issues; CC≤10 per new function; treat warnings as errors |
| Unit / integration tests (existing) | No regression in known behaviour | Agent editing/deleting tests; skipping | seconds–minutes | strong for regressions | every iteration; blocking | `vitest`, `pytest -x -q`, `go test -race -shuffle=on -count=1 ./...` | 100% pass; deny edits to `tests/**` in a fix task unless the task is test-writing (pi `tool_call` guard) |
| Diff / patch coverage | New lines are executed by some test | Assertion-free tests ("smoke"), change-detector tests | seconds after tests | medium | pre-commit / PR | `diff-cover coverage.xml --compare-branch=origin/main --fail-under=80`, `c8 --check-coverage --lines 80` scoped to changed files, `go tool cover` + script | ≥80% on changed lines (imti.co, Sonar way); project floor separate |
| Oracle-strength check on new tests | Tests assert real values, not just "runs" | — | seconds | medium | PR, cheap | AST rule: every new `test(`/`def test_` contains ≥1 value-comparing assertion (S1–S3 in All-Smoke taxonomy); flag `assert True`, `assert result`, `expect(x).toBeDefined()` only | 0 new weak-oracle-only tests |
| Mutation testing (source) | Tests can *fail* when logic changes | Equivalent mutants; timeouts; tests that assert on mocks | minutes–hours (parallel, CPU-bound) | strong | pre-merge on changed files; nightly full | **TS:** Stryker `--incremental --mutate "src/foo.ts"`; `thresholds:{high:80,low:60,break:70}` exits 1 below `break`. **Py:** `mutmut run --paths-to-mutate src/x.py` (cached/incremental, `--CI` non-zero exit), or Cosmic Ray for distributed. **Go:** gremlins `unleash --threshold-efficacy 60 --timeout-coefficient 3`; go-mutesting (avito) has score gate, changed-lines filter, baseline of accepted survivors; mutate4go per-file zero-survivor loop. **Rust:** cargo-mutants | changed-files: no survivors on new code (Uncle Bob) or ≥70% killed (Stryker break); whole-repo: ≥60% efficacy (gremlins default), report only |
| No-op stub check (coarse mutation) | The new test targets the function it claims to | Tests that pass against `return 0` / `throw NotImplemented` | seconds | medium, very cheap | test-writing tasks; blocking | SWE Atlas: hollow out the function under test, rerun the agent's manifest of tests; pass iff green before and red after | binary: must fail against stub |
| Bug-contrast replay (B/S/G) | Fix's evidence discriminates buggy vs fixed | Regression-only tests | seconds | medium | bug-fix tasks | BSG-VA: run agent's new tests on pre-fix commit; require ≥1 test that fails on B and passes on S | ≥1 bug-discriminating test; feed B-replay result back to agent (+7.4pp) |
| Acceptance / black-box tests (held out) | External contract met; no architecture leak | Nothing cheap; only by contamination | minutes | strongest for "done" | end of slice; blocking | SCBench pytest groups (CORE/REGRESSION/ERROR), APS Gherkin → generated entrypoints, Playwright API tests | strict pass (all + inherited regression) |
| Acceptance-data mutation | Acceptance tests are wired to the app | — | minutes | medium | nightly / before release | APS `bb gherkin-mutator` (exit 1 on survivor) | 0 survivors |
| Property-based / fuzz | Invariants hold across generated inputs | Weak properties; agents can't infer subtle semantics | minutes | strong where properties exist | after unit tests, for pure/parsing/serialisation code | `fast-check`, `hypothesis` (+ `RuleBasedStateMachine`), `go-fuzz`/`testing.F` | ≥1 property per new pure function of type (parse/serialise, sort/merge, idempotent op); Anthropic agent: 56% of reports valid, 81% for top-ranked — treat findings as candidates |
| Architecture / dependency rules | Layering, cycles, forbidden imports | Nothing cheap | seconds | medium | pre-commit | `dependency-cruiser`, `import-linter`, `go-arch-lint`, Uncle Bob `dependency-checker` | 0 violations, 0 new cycles |
| Duplication delta | New code doesn't clone | Renaming (structural tools resist) | seconds | weak–medium | PR | `jscpd`, `dry4go`, SCB duplication metric, Sonar ≤3% new-code dup | ≤3% dup in new code; trend alarm |
| Security / deps | No known vulns, no secrets | — | seconds–minutes | medium | PR | `npm audit`/`osv-scanner`, `gosec`+`govulncheck`, `bandit`, `gitleaks`, semgrep | 0 high/critical |
| Screenshot / visual diff | UI unchanged or changed as intended | Anti-aliasing noise; dynamic content | seconds–minutes | medium for UI | UI tasks; PR | Playwright `toHaveScreenshot({maxDiffPixelRatio:0.01})` with baselines in repo; Percy/Chromatic (paid) | 0 unexpected diffs; intended diffs require baseline update in same PR |
| Agent-driven UI/E2E test with proof artifacts | Feature works end-to-end | Agent asserting what it expects to see | minutes, LLM tokens | medium | end of UI slice | Devin 2.2 "test plan grounded in source → operate app → annotated timeline → video/screenshots"; open equivalents: pi + `agent-browser`/Playwright MCP, deterministic login scripts extracted as skills; Cognition bills test mode at 1/5 cost | report reviewed by human/LLM; must include per-assertion pass/fail list |
| LLM review (single pass) | Finds bugs/missing error handling | Hallucinated issues; nit spam | $0.05–0.5/PR, 1–4 min | medium, noisy | PR (non-blocking) | `pi-review`, Claude Code `/code-review`, CodeRabbit | never a hard gate alone |
| LLM review chain (generate → grade → dedupe → suppress) | High-precision comments | Less | 2× single pass | medium–strong | PR | uReview pattern; graders from a different vendor; golden set for F1 | post only ≥ confidence threshold; measure "addressed" by re-running on final commit |
| Rubric judge (binary checklist) | Engineering-quality items (placement, conventions, negative rubrics) | Vague rubric items | $ per PR | medium | PR / eval | SWE Atlas rubrics (YES/NO items, must-have subset), SCB `llm_judge.jsonl` | must-have items all YES; rest advisory |
| Adversarial verifier agent | Independent attempt to break the change | Shares blind spots with author model | high | medium | end of slice, high-value tasks | second pi session with only spec + diff, told to write a failing test; Dex's "dumb model extends smart model" probe | any failing test it finds blocks |
| Evidence gates (pre-action) | Agent looked before it patched | — | none (saves tokens) | medium | inside loop, before edits | ECLoop: compile per-task "observe X before editing Y" conditions; +4.8–11.8pp SWE-bench, −12% tokens | e.g. must have read the failing test + target file before `edit` |
| Held-out checkpointed evals | Harness/model maintains a codebase over time | Contamination | hours, $10s–100s | strongest for harness | CI for the factory itself | SlopCodeBench (`--agent pi`), private problems with canaries | strict-pass count + quality trajectory; Dex's lights-off bar: ≥80% |
| Runtime canary / prod metrics | Real users unaffected | — | days | ultimate | post-merge | feature flags, error-rate SLOs, auto-rollback | error-rate delta < X% |

## Gate ordering for a pi worker (proposed)

```
inner loop (every few tool calls, <30 s):    typecheck → lint → focused tests (pytest -x / vitest related)
pre-handoff `make verify` (1–10 min):        full tests -race/-shuffle → diff coverage ≥80% → weak-oracle scan on new tests →
                                             arch rules → dup delta → security scan → build → (test-writing task) no-op stub check →
                                             (bug-fix task) B/S/G replay → mutation on changed files (0 survivors / break 70)
PR (async, 5–30 min):                        held-out acceptance suite → screenshot diff → LLM review chain (grade→dedupe→suppress) → rubric must-haves
nightly / pre-release:                       full mutation run (report), acceptance-data mutation, property-based sweep, SCBench-style harness eval
```
Blocking rule of thumb: everything above the LLM rows can block; LLM rows produce comments and a score; a human (or a second-model verifier for high-value tasks) decides on the score.

## Notable techniques worth stealing

- **Make "tests can fail" a gate**: no-op stub check (SWE Atlas) is a 5-second, zero-noise proxy for mutation on test-writing tasks; B/S/G replay is the equivalent for bug fixes.
- **Weak-oracle scan**: an AST rule catching assertion-free tests addresses the single most common failure in agent tests (80.2% of patches).
- **Incremental mutation everywhere**: Stryker `--incremental` (reuses `reports/stryker-incremental.json`; `--force --mutate src/app.js:5-7` to re-run), mutmut cache, mutate4go footer manifest, go-mutesting baseline file — mutation cost proportional to the diff.
- **Score-based exit codes**: Stryker `thresholds.break`, mutmut `--CI`, gremlins `--threshold-efficacy`, go-mutesting score gate — all map to a `make verify` non-zero exit the agent can read.
- **Different model as grader**; suppression categories in-repo; "addressed" measured by re-run.
- **Evidence gates** compiled from the task (ECLoop) — implementable as a pi `tool_call` handler that denies `edit` until required `read`s have happened; saves tokens.
- **Proof artifacts** (Devin): annotated timeline + screenshots per assertion; extract flaky steps (login) into deterministic scripts/skills.
- **Property-based tests from docstrings/types** (Anthropic agent loop: read → propose properties → write Hypothesis → run → reflect), with a severity rubric to rank findings before humans look.
- **Verify hash gate**: pre-commit hook denies `git commit` unless `.claude/.last-review.md`/verify artifact hash matches the staged diff (imti.co) — port to pi `tool_call` on `git commit|gh pr create`.
- **`make verify` as the single interface**: agent never has to know the tool zoo; CLAUDE.md/AGENTS.md states thresholds once.

## Weaknesses / open questions / risks

- Mutation on TS monorepos is slow (Stryker needs per-package configs; dry run mandatory); budget CPU in the VM and cap `--mutate` to changed files.
- Equivalent mutants force a non-100% threshold, which agents can then game by adding easily-killed code; combine with per-file zero-survivor on *new* functions.
- Agents edit tests to pass: need a policy layer (deny `tests/**` writes in fix tasks; require test diffs to be reviewed separately).
- LLM graders drift with model updates; keep a golden set and re-measure F1 on model change.
- Screenshot baselines churn; keep them per-component, not per-page.
- Research results (ECLoop, BSG-VA, All-Smoke) are single papers from Jun–Jul 2026; treat effect sizes as provisional.

## Fit for our agentic stack (pi, cloud VMs, open source)

- **pi extension `verify-gate`** (TypeScript, `tool_call` hook): (1) deny `git commit`/`gh pr create` unless `.goblin/verify.json` exists with `head_sha == HEAD` and `status == pass`; (2) deny writes under `tests/**` when task type is `fix`; (3) ECLoop-style: deny `edit` of a file the session has not `read`. All three are ~100 lines each and pure-local.
- **`make verify` in every template repo**, tiered by task type: `verify:fast` (typecheck, lint, tests), `verify` (adds diff-cover ≥80, weak-oracle scan, arch, dup, security, build), `verify:deep` (mutation on `git diff --name-only origin/main`, stub check, B/S/G). Emit `verify.json` with per-gate status so the agent (and the orchestrator) parse one artifact.
- **Mutation tool choice**: TS → Stryker (`@stryker-mutator/vitest-runner`, incremental, `break:70`); Py → mutmut 3 (`paths_to_mutate` from diff, `--CI`); Go → gremlins for local, go-mutesting (avito fork) if you want a baseline file and diff mode; all run in the VM, parallel to worker count.
- **Review chain as a second pi session** using `pi-review`-style diff checkpoints: Sonnet-class generator → Haiku/o4-mini-class grader → dedupe → `review-suppress.yaml`. Log addressed/unaddressed by re-running on final commit.
- **Held-out acceptance in the orchestrator**: for multi-slice epics, keep acceptance tests out of the worker's VM; run cumulative tests per slice like SCBench; strict pass = done.
- **Harness CI**: weekly `slop-code run --agent pi` on 3 private problems; alarm on strict-pass drop or erosion inflection.
- **Skip for now**: paid visual diff services, per-category grader thresholds (no volume), Bazel-style per-test sandboxes.

## Related resources mentioned

- Trail of Bits `skills` repo (mutation-testing skill; "enforcing 100% kill rates across Rust/Python/JS" for mewt/muton) — https://github.com/trailofbits/skills — agent-facing mutation workflow text to port.
- covguard (diff-scoped coverage gate for PRs) — https://github.com/EffortlessMetrics/covguard
- LLM-based test oracles SLR (source-of-authority taxonomy) — https://arxiv.org/html/2607.05031
- "The Judge Is Leaving the Agent Loop" (Developers Digest) — https://www.developersdigest.tech/blog/the-judge-leaves-the-loop — argues evidence gates / verifiable rewards / certificates replace judges; cites ECLoop, BSG-VA, HALO (2607.27636), CS-RNR (2607.28520).
- Devin 2.2 self-verification / Devin Security Swarm — https://cognition.com/blog/introducing-devin-2-2
- Playwright visual regression guides (2026) — https://qaskills.sh/blog/playwright-visual-regression-testing-guide

## Key quotes / references

> All Smoke, No Alarm: "80.2% of test patches contain weak or no explicit oracle signals"; strong multi-signal oracles raise merge odds (OR 1.28) after controls.
> BSG-VA: "23.8% of baseline rollouts… close with a patch whose entire positive evidence base is" non-bug-discriminating.
> SWE Atlas: "agents write comprehensive tests but with weak assertions, so the test passes on the broken mutant code just as it does on the original."
> ECLoop: raises "Pass@1 by 4.8–11.8 percentage points" and "lowers average token consumption by up to 12.1%".
> imti.co: "Setting errorCode and warningCode both to 1 means any violation fails the build. No warnings that get ignored."
> Cognition: "async agents are only useful if developers can trust what they come back with."

---
## Gaps (R2, this cluster)

- SlopCodeBench paper body (arXiv HTML) not read directly; numbers come from README/blog/Dex's note. The runner's `docs/problems/tutorial.md` and how to point at a *private* problems checkout were not verified.
- AutoCover: mutation operator set, mutant count bound, and pass threshold are not disclosed in the paper; uReview grader prompt/threshold values likewise.
- Uncle Bob: Clean AI episodes 1–3 and 6+ not enumerated (cleancoders.com page rendered empty); no efficacy numbers; licensing unresolved for every repo.
- SWE Atlas rubric files and harness not inspected on GitHub; Trail of Bits mutation skill file path not found (404 on guessed path).
- Cognition's blog gives no mechanism for how Devin decides a UI assertion passed (model routing only hinted).
- No hands-on run of Stryker/mutmut/gremlins timing in a cloud VM; thresholds above are vendor/blog defaults, not measured on our repos.
- Property-based-testing-in-loop: only Anthropic's offline campaign found; no evidence of PBT wired as a *gate* inside a coding-agent loop.
- Screenshot-diff for agents: only conventional Playwright guidance found; no agent-specific baseline-management pattern.
