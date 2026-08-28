# SlopCodeBench (SCBench) — checkpointed, held-out, black-box evals

- **URL:** runner https://github.com/SprocketLab/slop-code-bench ; problems https://github.com/gabeorlanski/scb-problems ; paper https://arxiv.org/abs/2603.24755 ; site https://www.scbench.ai ; blog https://gabeorlanski.github.io/posts/slop-code-bench/
- **Type:** eval harness / benchmark (validation oracle)
- **Author/Org:** Gabriel Orlanski et al. (SprocketLab, UW–Madison; Sala/Albarghouthi groups). Popularised by Dex Horthy / HumanLayer ("Why Software Factories Fail" pt. 3 — see `research/blogs/dexhorthy-2081797628552270027.md`; this file does not redo that).
- **Researched:** 2026-08-26
- **Status/maturity:** runner 172 stars, MIT, last push 2026-08-04, Python 3.12+/uv/Docker, "initial release… community-driven evaluation primitive rather than a finalized benchmark". Problems repo: Apache-2.0 (README badge says MIT), 6 stars, last push 2026-05-16, 34 problems (paper: 20 problems / 93 checkpoints; site now lists ~34 dirs). Also published as a Harbor dataset (`registry.harborframework.com/datasets/gabeorlanski/slopcodebench`). **A `pi` agent adapter already ships in the runner** (`configs/agents/pi.yaml`, `src/slop_code/agent_runner/agents/pi/`).

## One-paragraph summary

SCBench is a long-horizon coding benchmark in which an agent implements a spec (checkpoint 1), then repeatedly *extends its own code* as the spec is refined (checkpoints 2..N, each "arrives cold"). Verification is a hidden pytest suite that treats the submission as a black box (CLI entrypoint or API server; no function signatures or architecture prescribed), and checkpoint N's run also replays checkpoints 1..N-1's tests as REGRESSION. Alongside correctness it records per-checkpoint quality trajectories: deterministic metrics (cyclomatic complexity, duplication, lint density, "structural erosion") and an optional 45-criterion LLM-judge "verbosity" rubric. No model in the paper solves any problem end-to-end (best checkpoint solve rate 17.2%); Dex's Opus 5 run got 4/17 strict passes. Its value to a factory is less as a leaderboard than as a *reusable runner for checkpointed, held-out, unattended evals of your own harness*.

## Core ideas / thesis

- **Iteration is the thing to measure.** Single-shot benchmarks miss "path dependence, non-convergence, and trade-offs between explicit handling and structural stability."
- **Hidden black-box tests as oracle.** "Only a CLI interface or API contract is provided… the test suite stays hidden so it can't leak architectural hints." Normalisation code absorbs formatting differences.
- **Regression is cumulative.** Tests for checkpoint N assume all prior checkpoints still pass; a defect at ck4 sinks 5..N.
- **Quality is a trajectory, not a snapshot.** Track verbosity and structural erosion per checkpoint; the interesting signal is the inflection where "new requirements start fighting the initial design".
- **Deterministic first, judge second.** Correctness and structural metrics are model-free; the LLM judge (`slop-code metrics judge`) is a separate, optional layer with its own rubric file.
- **Contamination defence.** Every `config.yaml` carries a canary ("SENTINEL PHRASE: VIOLET ASTEROID TEASPOON", GUID `31f979c3-…`), plus `inject_canary.py`.

## Architecture & mechanics

**Repo layout (runner):**
```
configs/agents/{claude_code,codex,cursor_cli,gemini,kimi_cli,miniswe,opencode,openhands,pi}.yaml
configs/environments/docker-python3.12-uv.yaml
configs/prompts/{just-solve,anti_slop,plan-and-test,plan_first}.jinja
configs/rubrics/llm_judge.jsonl + templates/{criteria,criteria_with_pn,no_expl,prefix_multi_file}.j2
src/slop_code/agent_runner/agents/<agent>/{agent.py,docker.j2,parser.py}
src/slop_code/evaluation/   # pytest runner, group types, pass policies
src/slop_code/metrics/      # driver.py, grade.py (LLM judge), quality metrics
```

**Problem layout (scb-problems):**
```
<problem>/config.yaml        # name, difficulty, entry_file, timeout, checkpoints{order,state}, test_dependencies
<problem>/checkpoint_N.md    # spec shown to the agent at checkpoint N
<problem>/files/             # static assets copied into workspace
<problem>/solution/          # reference solution (must pass all checkpoints)
<problem>/tests/conftest.py, test_checkpoint_N.py, data/, assets/
```

**Test categorisation (pytest markers):** unmarked = **CORE** (must pass); `@pytest.mark.functionality` = FUNCTIONALITY; `@pytest.mark.error` = ERROR (edge cases); tests from earlier checkpoints = **REGRESSION**. Pass policies: `any`, `all-cases`, `all-non-error-cases`, `core-cases` (Dex's "strict pass" = everything incl. inherited regressions green). Tests run via `uvx` in a Docker environment per checkpoint.

**Agent lifecycle** (`docs/agents/agent-class.md`): `from_config → setup(session) → per checkpoint: run(task) / run_checkpoint(task) → save_artifacts(path) → finish_checkpoint() (reset + accumulate cost) → cleanup()`. Fresh context per checkpoint is the default (reset between checkpoints); the container/workspace persists, so the agent sees its own prior code but not its prior conversation.

**pi adapter** (`agents/pi/agent.py`): installs `@earendil-works/pi-coding-agent@{{version}}` in the Docker image; invokes
```
pi --print --mode <mode> --no-session --provider <p> --model <m> [--thinking off|minimal|low|medium|high|xhigh] <extra_args…> "<prompt>"
```
and parses `stdout.jsonl` for usage/cost. Protected flags (cannot be overridden via `extra_args`): `--print/-p --mode --no-session --session --continue --resume --provider --model --api-key`. Provider map covers anthropic/openai/openai-codex/google/openrouter/bedrock/zai/minimax/vercel-ai-gateway/… Config (`configs/agents/pi.yaml`):
```yaml
type: pi
binary: pi
version: 0.74.0
timeout: 7200      # seconds per checkpoint
extra_args: []     # e.g. ["--extension", "/workspace/.pi/gate.ts"] to test your harness
env: {}
cost_limits: {cost_limit: 0, step_limit: 0, net_cost_limit: 0}
```

**Prompts:** `just-solve.jinja` is one line ("Implement a program that 100% solves the specification…"), with an `is_continuation` branch for checkpoints ≥2. `anti_slop.jinja` adds a slop-avoidance list (no trivial wrappers, no single-use variables, no if/else ladders…). `plan-and-test.jinja` mandates plan → write tests → simple solution → edge cases → simplify.

**Metrics:** `results.json` (correctness), `overall_quality.json` per run. Deterministic: SLOC, function counts, cyclomatic mean/max/spread, nesting, duplication, lint errors/LLOC; "structural erosion" = % functions with CC>10 (CC>30 counted twice) + lint errors per LLOC. LLM judge: `llm_judge.jsonl` has ~45 named criteria (e.g. `narration_comments`, `echo_docstrings`, `lonely_interface`, `single_entry_registry`, `delegation_only_class`) each with `positive_indicators`/negatives; graded via OpenRouter model with `criteria_with_pn.j2`.

## Workflow: end to end (running it against your own agent)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
git clone https://github.com/SprocketLab/slop-code-bench && cd slop-code-bench && uv sync
git clone https://github.com/gabeorlanski/scb-problems   # point runner at it (docs/commands/run.md)
export ANTHROPIC_API_KEY=...

# 1. run pi on a couple of problems (first run builds the Docker image, 5-10 min)
uv run slop-code run --agent pi --model anthropic/opus-4.5 \
  --environment configs/environments/docker-python3.12-uv.yaml \
  --prompt configs/prompts/just-solve.jinja \
  --problem file_backup --problem database_migration \
  thinking=medium version=0.74.0 pass_policy=all-cases

# 2. evaluate (hidden tests, cumulative regression)
uv run slop-code eval outputs/<run-dir>/ --num-workers 4

# 3. optional LLM-judge verbosity grading
uv run slop-code metrics judge --rubric configs/rubrics/llm_judge.jsonl \
  --model <openrouter model> --criteria-template configs/rubrics/templates/criteria_with_pn.j2 \
  --prefix-template configs/rubrics/templates/no_expl.j2
```
To test **your harness** rather than bare pi: either (a) put your extensions/skills/AGENTS.md into the Docker template (`agents/pi/docker.j2`) or the problem's `files/`, and pass `extra_args: ["--extension", "..."]`; or (b) copy `agents/pi/` to a new `agents/goblin/` that shells out to your orchestrator, register it (`register_agent`), and add `configs/agents/goblin.yaml`. Parallelise by (model × problem), not by model.

To make **your own checkpointed problems**: copy `file_backup/`, write `checkpoint_N.md` that each add *capability*, a `solution/` that passes everything, `tests/test_checkpoint_N.py` runnable per checkpoint, keep the canary block. Authors target problems that "take ~40 hours to solve well".

## Notable techniques worth stealing

- **Checkpointed spec + cumulative hidden tests** as the definition of "done" for a multi-slice feature: slice N is done only when tests for slices 1..N are green and the agent never saw the tests.
- **Fresh session per checkpoint, persistent workspace** — separates "can the model continue from its own code" from "can it remember the conversation".
- **Test group types** (CORE / FUNCTIONALITY / ERROR / REGRESSION) with explicit pass policies — copy the marker scheme into the factory's acceptance suites so "strict pass" vs "core pass" is a config knob.
- **Canary strings** in every private eval problem so leakage into training/prompt corpora is detectable.
- **Quality trajectories** (`overall_quality.json` deltas between checkpoints) as backpressure; alarm on inflections, not absolute values.
- **Separate rubric file for the judge** (`llm_judge.jsonl` with positive/negative indicators per criterion) — machine-readable, versionable, and cheap to extend.
- **pi already supported** — zero adapter work to benchmark the runtime.

## Weaknesses / open questions / risks

- Python-only problems and Python-only slop detectors today (Dex wants TS ports); the `docker-python3.12-uv` env is the only shipped environment.
- Slow and expensive: 3-8 checkpoints × up to 7200 s each; Dex's 9-session run took hours.
- Tiny community (172 stars, 6 on problems); docs versioned Dec 2025; "early-stage software".
- Metrics reward-hackable; "link between any one of them and 'is this codebase easy to change' is not yet established" (Dex).
- No one-shot problem contribution path for private problems documented beyond "point runner at a local checkout".

## Fit for our agentic stack (pi, cloud VMs, open source)

- **Adopt as the harness regression suite.** Keep 3-5 private checkpointed problems shaped like real factory tasks (one CLI, one HTTP API, one migration-style) in a private repo with canaries; run `slop-code run --agent pi` on every change to the factory's extensions/prompts/model routing; scorecard = strict-pass count + quality trajectory. Runs in Docker so it fits a cloud VM job.
- **Adopt the marker scheme** (CORE/REGRESSION/ERROR) in factory acceptance suites; wire `pass_policy` into the gate config.
- **Adapt the runner into the factory's "definition of done".** For a multi-PR epic, hold out acceptance tests in the orchestrator, expose only the spec to the worker, run cumulative tests per slice.
- **Skip** the LLM judge as a gate; keep it as a report (matches Dex's stance).
- **Licence**: MIT runner / Apache-2.0 problems — compatible with an open-source factory.

## Related resources mentioned

- Harbor framework dataset registry — https://registry.harborframework.com/datasets/gabeorlanski/slopcodebench/latest — packaging format for agent benchmarks; may be a cleaner way to ship private evals.
- humanlayer follow-up runs (Fable/Sol/Kimi) — https://github.com/humanlayer/advanced-context-engineering-for-coding-agents
- SWE Atlas (Scale) — https://arxiv.org/abs/2605.08366 — manifest + no-op-stub mutation check + rubric judge for test-writing tasks (see validation-landscape.md).

## Key quotes / references

> "We release SCBench as an open, community-driven evaluation primitive rather than a finalized benchmark."
> "Only a CLI interface or API contract is provided… the test suite stays hidden so it can't leak architectural hints."
> "Tests for checkpoint N assume all prior checkpoints still pass — exposing path dependence and regressions that single-shot benchmarks miss."
> FAQ: good problems "take ~40 hours to solve well (not just make it work)".
