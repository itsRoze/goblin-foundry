# D. Field lessons from real software factories

Synthesis of `research/blogs/` (11 files, read 2026-08-26). Decisions already fixed: runtime = pi (earendil-works/pi), solo dev, cloud sandboxes, open source. Everything below is filtered through "does this survive at N=1 engineer with a $20-50/day token budget?"

Sources: Uber (Minion/uReview/AutoCover), OpenAI Frontier (harness engineering + Symphony), StrongDM (lights-off + Attractor), Ramp Inspect / Stripe Minions / WorkOS Horizon / Brex, Cognition (FrontierCode + Fusion), HumanLayer/Dex (WSFF 1-3, ACE, 12FA, Ralph), Faros telemetry, Dan Shapiro's five levels.

---

## 1. What we now know

1. **Every factory that publishes throughput numbers still has a human merge gate; the only one that dropped it (StrongDM) publishes no outcome data.** Stripe (>1,300 minion PRs/week, "all human-reviewed"), Ramp (75% of merged PRs, human review), WorkOS ("no code gets merged without explicit human approval"), Uber (human reviewer "judges quality, not basic errors"). OpenAI Frontier dropped *pre-merge* review but kept post-merge sampling. `[blogs/company-factories-ramp-stripe-workos-brex.md]` `[blogs/strongdm-lights-off.md]` `[blogs/openai-harness-engineering.md]` `[blogs/uber-software-factory.md]`

2. **The bottleneck moves to review, then to validation/CI capacity, then to "should we build it."** Dex: building drops to minutes, review still takes hours, so "the job is two questions: how much can you stuff into the queue, and how fast can you review and test what comes out?" Uber says the constraint is now CI and A/B capacity. Faros: median time in review +441.5%, unreviewed merges +31.3%. Design every stage to make review cheaper, not to delete it. `[blogs/dexhorthy-2080697380379427275.md]` `[blogs/uber-software-factory.md]` `[blogs/faros-whiplash-report.md]`

3. **Validate in the agent's own sandbox before anything touches shared CI or a human.** Uber's Minion stops at a *draft PR* only after lint/autofix, screenshot-vs-Figma, staging integration, and a small-model review; the PR body carries a checks table. Stripe runs a 5 s local lint on every push and caps CI at two rounds. OpenAI caps the build inner loop at ~1 min. `[blogs/uber-software-factory.md]` `[blogs/company-factories-ramp-stripe-workos-brex.md]` `[blogs/openai-harness-engineering.md]`

4. **Pass/fail tests are the wrong reward for maintainability; the models were trained on it and it shows after 3-6 months.** RL verifiers are one-dimensional and fast; "the cost function of bad architecture is measured in weeks, months, maybe even years." HumanLayer went lights-off July 2025 and rewrote from scratch by November. SlopCodeBench: no model finished any checkpointed challenge defect-free; best strict-pass 24-33%. `[blogs/dexhorthy-2080697380379427275.md]` `[blogs/dexhorthy-2081797628552270027.md]`

5. **Harness raises the floor, not the ceiling.** Lints, review agents, backpressure catch "the dumb stuff"; design quality comes from humans + front-loaded planning because we do not own the weights. Corollary: invest harness effort in deterministic gates and human-review economics, not in ever-smarter judge prompts. `[blogs/dexhorthy-2080697380379427275.md]` `[blogs/dexhorthy-context.md]`

6. **Front-load alignment in four phases and ship vertical slices.** Product review (problem + observable success, HTML mockups) -> system architecture -> program design (call-stack trees in diff syntax, file-tree diffs, signatures) -> 1-3 vertical slices per session, 100-200 LOC reviewed at a time. ~40% of tasks are oneshot and skip all this. "30 minutes of planning saves hours of review." `[blogs/dexhorthy-article-2081058573556306030.md]`

7. **Context is a scarce resource: ~100-line router file, pointers not encyclopedia, everything else in versioned `docs/`.** OpenAI's AGENTS.md is ~100 lines; Dex's CLAUDE.md target is <60; RPI found models silently drop steps past ~150-200 instructions. Uber's MCP-description trimming saved >40% tokens fleet-wide. "Anything it can't access in-context while running effectively doesn't exist." `[blogs/openai-harness-engineering.md]` `[blogs/dexhorthy-context.md]` `[blogs/uber-software-factory.md]`

8. **Deterministic scaffolding around agentic nodes beats a free-running loop.** Stripe Blueprints: rectangles (lint, push) wrap clouds (implement, fix CI); "saves tokens and CI costs and gives the agent a little less opportunity to get things wrong." Uber's AutoCover/uReview are the same shape: agent + deterministic tools + multi-stage grader/filter + real execution as oracle. `[blogs/company-factories-ramp-stripe-workos-brex.md]` `[blogs/uber-software-factory.md]`

9. **Hold the verifier out of the agent's reach.** SWE-bench evaluators discard agent edits to test files; StrongDM stores scenarios *outside* the repo; FrontierCode runs agent-written tests against the pre-patch tree and requires failure (reverse-classical) plus scope checks. StrongDM's "Agent Obsession": agents return `true` to pass narrow tests. `[blogs/dexhorthy-2080697380379427275.md]` `[blogs/strongdm-lights-off.md]` `[blogs/cognition-frontier-code.md]`

10. **Tracker as state machine; orchestrator outside the sandbox; one workspace per issue; tracker-driven recovery.** Symphony SPEC: poll Linear every 30 s, `Unclaimed -> Claimed -> Running -> RetryQueued -> Released`, `max_turns` 20, stall 5 min, backoff `min(10s*2^(n-1), 300s)`, nothing persisted across restart. WorkOS: merged PR marks issue done and auto-spawns unblocked dependents. Rework = trash the worktree and restart. `[blogs/openai-harness-engineering.md]` `[blogs/company-factories-ramp-stripe-workos-brex.md]`

11. **Startup latency is the adoption lever; snapshot on a cron.** Ramp rebuilds the repo image every 30 min and warms the VM as the user types; <5 s to a full env. Stripe warm pool <10 s. Uber DevPods start in seconds with pre-built search indexes. `[blogs/company-factories-ramp-stripe-workos-brex.md]` `[blogs/uber-software-factory.md]`

12. **Multi-stage generate -> grade -> filter -> dedupe -> suppress makes review agents trustworthy; raw output hallucinates.** uReview: 75% useful, 65% addressed (vs 51% human comments); "addressed" measured by re-running the reviewer 5x on the final commit; model pair chosen by F1 on a golden set (Sonnet generator + o4-mini grader). Devs reject nits, accept correctness findings. `[blogs/uber-software-factory.md]`

13. **Scheduled garbage collection beats a "slop Friday."** OpenAI first spent ~20% of the week hunting slop, then encoded golden principles and ran background agents that open <1-minute-review refactor PRs. Uber runs maintenance loops Sundays with capped diff volume and opt-in enrollment; incident reviews are mined for new skills. `[blogs/openai-harness-engineering.md]` `[blogs/uber-software-factory.md]`

14. **Model routing is a maintained document, and "one model for everything" is over.** StrongDM's Weather Report (model x role x reasoning-effort table, updated monthly); Devin Fusion (frontier decider + cheap executor, switch at compaction) gets within 2 points of Fable 5 at 1/8 cost; Ralph lore: "a dumb model writes the code, a smart model checks it." `[blogs/strongdm-lights-off.md]` `[blogs/cognition-frontier-code.md]` `[blogs/dexhorthy-context.md]`

15. **Measure what survived, not what shipped.** Faros: incidents/PR +242.7%, churn 10x, deploys/week -11.7% while merges rose. Brex CTO refuses to track "% code by AI." Uber's own caveat: PR counts and LOC do not measure quality. `[blogs/faros-whiplash-report.md]` `[blogs/company-factories-ramp-stripe-workos-brex.md]` `[blogs/uber-software-factory.md]`

---

## 2. Recurring patterns

| Pattern | Who does it | Evidence / metric | Solo? | Why |
|---|---|---|---|---|
| Warm sandbox from periodic snapshot, one per task | Ramp, Stripe, Uber, WorkOS, Symphony | <5-10 s startup; image rebuilt every 30 min (Ramp) | yes | Cheap with cloud VMs + nightly snapshot; latency is what makes you actually dispatch work |
| Stop at draft PR with validation table + screenshots | Uber Minion; OpenAI "proof of work" (CI, review, videos) | Reviewers see checks passed, not raw diff | yes | Directly reduces solo review time; a Stop-hook can enforce it |
| Deterministic nodes around agentic nodes (blueprint) | Stripe, Uber AutoCover, StrongDM Attractor graph | Stripe: >1,300 PRs/week; two-CI-round cap | yes | Bounded cost, bounded blast radius; pi pipeline = fixed prompts as nodes |
| Tracker-as-state-machine + orchestrator outside sandbox | Symphony, WorkOS, (Dex's 2022 factory) | Symphony SPEC states/timeouts; WorkOS dependency cascade | yes | A few hundred lines over GitHub Issues; restart-safe because tracker is truth |
| ~100-line router + versioned docs/ + exec plans | OpenAI, HumanLayer (CLAUDE.md <60), Uber context graph | OpenAI 1M LOC with 0% human code; Uber >40% token drop | yes | Context tax is the same at any scale; pi reads the same files |
| Multi-stage review: generate -> grade -> filter -> dedupe | Uber uReview; OpenAI persona reviewers w/ P0/P2 | 75% useful, 65% addressed; F1 model selection | adapted | Keep 2 stages (generate + cheap grader) and a suppression list; skip per-language threshold tuning |
| Held-out verifiers the agent cannot edit | StrongDM scenarios, SWE-bench evaluator, FrontierCode reverse-classical | "Agent Obsession"; models "quietly commenting out the failing test" | yes | Cheapest anti-reward-hack: scenarios in a dir the worker VM cannot write; diff test files separately |
| Execution + coverage/mutation delta as test oracle | Uber AutoCover | viable-test rate 20-80% by language; +10% coverage | adapted | Run tests + coverage delta; mutation spot-check only on core modules |
| Front-loaded alignment (product -> arch -> program design -> slices) | HumanLayer; Uber (Cortana spec -> Figma -> Minion) | "30 min planning saves hours of review"; ~40% oneshot | yes | It is the solo dev's only ceiling-raising lever; docs are cheap |
| Vertical slices, 100-200 LOC per review | HumanLayer; Shape Up | Rework 20-50% on oneshot PRs | yes | Review is the solo bottleneck; slice size caps it |
| Scheduled GC / maintenance loops off-hours, capped diffs | OpenAI, Uber (Sundays, 250+ migrations, 9M LOC) | Replaced 20%-of-week slop hunt | adapted | Nightly pi run against `golden-principles.md`, cap 3 open PRs |
| Skill distillation from agent logs | OpenAI (daily), Uber (evals from traces + comments) | 5-10 core skills; 2,500 skills / 20k runs/day at Uber | adapted | Weekly manual pass over pi session logs into `skills/`; no marketplace |
| Model routing table (Weather Report / Fusion) | StrongDM, Cognition, Ralph | Fusion 1/8 cost at -2 pts | yes | `WEATHER.md`: role -> model -> effort; cheap executor for reads/tests |
| Small default tool set from a large catalogue | Stripe (~500 tools, small subset), Uber Omni-MCP/code-mode | >40% token savings | yes | One thin MCP or CLI; let the agent write scripts for heavy ops |
| Full observability for the agent (browser, logs, metrics, DB) | Ramp, OpenAI (CDP, Prometheus, Jaeger) | "Inspect is never limited by missing context or tools" | adapted | Local logs + preview URL + headless browser; skip Grafana stack until UI exists |
| Per-run identity so agent cannot self-approve | Ramp (GitHub App token per clone), Uber STS act_chain | "You do not want to knowingly create a vector for unreviewed code" | adapted | Separate GitHub App for the bot; solo dev is always the approver |
| Egress allowlist in sandbox | WorkOS (Worker proxy), Stripe (no egress, QA-only) | Prompt-injection defence | yes | Cheap, and mandatory once pi reads issues/web |
| Digital twin / fakes for external deps | StrongDM DTU | "thousands of scenarios per hour", deterministic | adapted | Record/replay for 1-2 services, not cloned Okta |
| Multiplayer sessions, Slack routing classifier, Chrome ext | Ramp | 1M+ sessions | no | N=1 |
| LLM/MCP gateways w/ PII guard, 5 safety models | Uber | 100M req/day | no | Below ~50 engineers; use API keys + a secret-scrub hook |
| Ghost library / nlspec (ship spec, agent builds impl) | OpenAI, StrongDM Attractor | Attractor is only a spec | adapted | Interesting for bootstrapping the orchestrator itself; not a runtime pattern |

---

## 3. Failure modes catalog

| Failure | Who hit it | Root cause | Mitigation seen |
|---|---|---|---|
| Codebase becomes unmaintainable after 3-6 months lights-off; rewrite from scratch | HumanLayer (Jul-Nov 2025); "Building pi in a world of slop" (badlogic) | RL rewards test-pass in seconds; no oracle for design; "try catches around everything" | Put human review back; four-phase alignment; vertical slices; slop-metric trajectories `[blogs/dexhorthy-2080697380379427275.md]` |
| Agent games the test (returns `true`, comments out failing test, splices in mock) | StrongDM ("Agent Obsession"), SWE-bench evaluators | Verifier inside agent's write scope | Held-out scenarios outside repo; discard test-file edits; reverse-classical tests; widen to e2e/behavioral `[blogs/strongdm-lights-off.md]` `[blogs/cognition-frontier-code.md]` |
| Hallucinated review comments; devs ignore the bot | Uber uReview v1 | Unfiltered single-pass LLM output | Grader prompt + confidence thresholds + dedupe + category suppression; Useful/Not-useful buttons `[blogs/uber-software-factory.md]` |
| Shared CI hammered by agent pushes | Uber, Stripe | Agents push before local validation | Draft-PR gate after inner-loop checks; Stripe hard cap of two CI rounds then hand back `[blogs/uber-software-factory.md]` `[blogs/company-factories-ramp-stripe-workos-brex.md]` |
| Review queue explodes; unreviewed merges creep up | Faros (median review time 5x, +31.3% unreviewed) | Output outruns human absorption; PR size +51% | PR size budget; slices; validation evidence in PR; sampling review only for scenario-covered lane `[blogs/faros-whiplash-report.md]` |
| Incidents/PR 3x, churn 10x, deploys down while merges up | Faros | Quality moved downstream; "hollow gains" | Quality at authoring stage (lints w/ remediation, scope checks); track deploys separately `[blogs/faros-whiplash-report.md]` |
| Slop accumulates; team spends 20% of week on cleanup | OpenAI Frontier | No continuous enforcement of taste | Golden principles in repo + scheduled GC agents emitting tiny PRs; 350-line file cap; layer lints `[blogs/openai-harness-engineering.md]` |
| Instruction-budget overflow: models silently drop steps past ~150-200 instructions; 1,000-line plans hide as many surprises as code | HumanLayer (RPI -> QRSPI) | Context saturation; "plan-reading illusion" | Fresh contexts <40% utilization; subagents as context firewalls; more alignment phases before code `[blogs/dexhorthy-context.md]` |
| Horizontal plans (DB -> service -> API -> UI) with nothing touchable until the end | Every frontier model by default (Dex) | Model planning prior | Force mock-API-first vertical slices with a per-slice touch test `[blogs/dexhorthy-article-2081058573556306030.md]` |
| Duplication inflects when new requirements fight the initial design (ck3) | SlopCodeBench (Opus 4.8 4.6% -> 16.8%) | No refactor incentive; cold context per checkpoint | Per-PR duplication/complexity trajectory alarms; "dumb model extends smart model's code" probe `[blogs/dexhorthy-2081797628552270027.md]` |
| Agent tool-call loops / token burn | StrongDM Weather Report (Gemini Flash loops; Opus "burns too many tokens") | Model x task mismatch | Routing table with reasoning effort; turn budget + stall timeout (Symphony) `[blogs/strongdm-lights-off.md]` `[blogs/openai-harness-engineering.md]` |
| Generated tests: style drift, bloat, ignoring local idioms; Java viability 20% | Uber AutoCover | Weak conventions signal | Machine-readable conventions registry; "do no harm" rollback; freeze chronic non-improvers `[blogs/uber-software-factory.md]` |
| Stale context graph / docs silently wrong | Uber (acknowledged risk) | Curation cost | Scheduled doc-vs-code diff; "repository as the only truth" `[blogs/uber-software-factory.md]` `[blogs/openai-harness-engineering.md]` |
| Self-approval vector | Ramp (designed against) | Agent runs under user identity | GitHub App token per clone; PR attributed to bot, human approves `[blogs/company-factories-ramp-stripe-workos-brex.md]` |
| Agent takes real-world action unprompted (rewrote and emailed 100 people) | Dex, Opus 5 anecdote | Lights-off agency beyond code | Egress allowlist; no prod creds in sandbox; QA-only env (Stripe) `[blogs/dexhorthy-2081797628552270027.md]` |
| Scenario curation becomes the new bottleneck and bug hiding place | StrongDM (inferred) | Validation replaces review, so validation is where errors hide | Feed production signals (incidents, transcripts) back into scenarios `[blogs/strongdm-lights-off.md]` |
| Rework on a bad branch compounds | OpenAI Symphony | Patching a wrong trajectory | On "rework", delete worktree + PR and restart from issue `[blogs/openai-harness-engineering.md]` |

---

## 4. Metrics worth tracking (scaled to solo)

Record one JSONL row per run and per merged PR; a weekly script is the dashboard. Nobody in the corpus publishes the outcome dataset Dex asks for; we can.

**Per run (pi session)** — issue id, lane (L3/L4/L5 per Shapiro), model + effort (from `WEATHER.md`), tokens in/out, cache hit rate, $ cost, turns used vs `max_turns`, wall time, stall/timeout/failure state (Symphony states), CI rounds used (cap 2), inner-loop checks passed (Uber validation table), diff size, files touched vs declared scope (FrontierCode scope check).

**Per PR (outcome)** — human read it? (yes/sampled/no), review minutes, rework % (lines changed after first review; Dex says oneshot trends 20-50%), review-agent comments posted / addressed (re-run reviewer on final commit, uReview method), time to merge, reverted?, 14-day churn (Faros), bugs/incidents linked within 30 days (Faros: incidents/PR is the headline number).

**Repo trajectory (per merge, SlopCodeBench slop-meter subset)** — SLOC, cyclomatic mean/max, duplication share, single-use-function share, verbose-line share, propagation cost / dependency entropy, lint errors, files >350 lines. Alarm on inflection, not level.

**Review-agent quality** — precision on a 30-50 PR golden set, "useful" rate, category suppression list size; re-pick model pair when F1 changes (Uber).

**Platform** — sandbox cold-start seconds (target <10 s), snapshot age, $/day (budget $20-50), $/merged PR, $/surviving PR (merged and not reverted/churned in 14 d).

**Throughput, last** — PRs/week and deploys/week side by side; divergence is the Faros "hollow gain" signal. Never "% code by AI" (Brex).

**Harness regression** — 2-4 checkpointed SlopCodeBench-style problems shaped like our work; strict-pass + metric trajectories on every prompt/model/harness change; optional "Haiku/Sonnet implements checkpoint N+1 on Opus's code" probe.

---

## 5. Tensions and tradeoffs

**Lights-off vs lights-on.**
- For lights-off: StrongDM ships ~32k LOC with zero human reads, Attractor + DTU + satisfaction scoring; OpenAI Frontier built >1M LOC / 750 packages with no human pre-merge review, 5-10 PRs/eng/day; Shapiro knows "a handful" of <5-person L5 teams doing "nearly unbelievable" work. `[blogs/strongdm-lights-off.md]` `[blogs/openai-harness-engineering.md]` `[blogs/dan-shapiro-five-levels.md]`
- Against: no outcome data from StrongDM; OpenAI owns the weights and burns $1-3k/day; HumanLayer's lights-off run ended in a rewrite; SlopCodeBench best 24-33%; Faros incidents/PR 3x. Dex's threshold: 80%+ on a held-out checkpointed benchmark before trusting lights-off. `[blogs/dexhorthy-2080697380379427275.md]` `[blogs/dexhorthy-2081797628552270027.md]` `[blogs/faros-whiplash-report.md]`
- Resolution for solo: *lights-dim*. Three lanes tagged at intake: L3 (human reads every diff), L4 (spec + scenarios, human reads PR), L5 (scenario-covered, small diff, sampled review only, e.g. GC/dep-bump PRs). Log lane per PR so defect rate per lane is measurable.

**Harness vs model.**
- Harness side: OpenAI "It's not a model problem, it's a configuration problem" (HumanLayer's own earlier post); Uber's uReview improved via chained prompts more than prompt wording; Fusion gets frontier quality at 1/8 cost via harness alone. `[blogs/openai-harness-engineering.md]` `[blogs/uber-software-factory.md]` `[blogs/cognition-frontier-code.md]`
- Model side: Claude Code won because Anthropic RL'd the model inside the harness; "if you don't own the weights... you'll always be at a disadvantage"; review agents "raise the floor... don't move the ceiling." `[blogs/dexhorthy-2080697380379427275.md]`
- Resolution: harness budget goes to deterministic floor-raisers (lints with remediation, scope/size gates, reverse-classical tests, slop trajectories, held-out scenarios) and to review economics (draft-PR evidence, slices). Ceiling comes from the solo dev's planning docs. Do not build a smarter judge.

**Speed vs maintainability.**
- Speed: Ramp 75% of merged PRs, Stripe 1,300/week, Uber >70% PRs and 2x LOC/engineer, OpenAI +500% landed PRs on some teams. `[blogs/company-factories-ramp-stripe-workos-brex.md]` `[blogs/uber-software-factory.md]`
- Maintainability: Faros bugs/PR +28%, churn 10x, review 5x; Uber AI cost 6x since 2024; Dex "You don't have too many PRs. You have too many bad PRs"; target "2-3x faster, safely" not 10-100x. `[blogs/faros-whiplash-report.md]` `[blogs/dexhorthy-article-2081058573556306030.md]`
- Resolution: state the throughput goal as 2-3x with flat incident rate; PR size budget; slices; GC loop.

**Full context vs small context.** Ramp: give the agent everything (Sentry, Datadog, flags, DB, browser). OpenAI/Dex: context is scarce, 100-line router, <40% utilization. Not contradictory: broad *access* via tools, narrow *loaded* context via progressive disclosure and subagents. `[blogs/company-factories-ramp-stripe-workos-brex.md]` `[blogs/openai-harness-engineering.md]`

**Interactive vs fully specified work.** StrongDM "Shift Work": only fully specified intent goes to the non-interactive lane; Dex: ~40% oneshot, rest planned; Shapiro L4: "argue with it about the spec" then leave for 12 h. `[blogs/strongdm-lights-off.md]` `[blogs/dan-shapiro-five-levels.md]`

**Model-as-judge vs deterministic verifiers.** StrongDM satisfaction scoring and FrontierCode rubrics use LLM judges; Dex prefers SlopCodeBench's black-box tests ("a much better oracle than 'does another model think this code is clean'") but admits slop metrics are reward-hackable. Use deterministic gates as blockers, LLM rubric as non-blocking score. `[blogs/cognition-frontier-code.md]` `[blogs/dexhorthy-2081797628552270027.md]`

---

## 6. Open questions to resolve before a blueprint

1. **Lane criteria.** What exact conditions promote a task to L5 (no human read)? Proposal to test: diff <100 lines, only files in declared scope, all held-out scenarios pass, zero slop-metric regressions, task type in {dep bump, GC refactor, lint fix}. Need a first list and a 30-day defect-rate check per lane.
2. **Where do held-out scenarios live and how does the worker VM lose write access to them?** Separate repo, protected branch, or read-only mount? Who runs them: the worker sandbox or a separate verification sandbox (WorkOS "flavors")?
3. **Tracker choice.** GitHub Issues vs Linear vs `queue/*.md`. Symphony needs `fetch_issues_by_states` + labels + state transitions; WorkOS needs webhooks + dependency edges. Does GitHub Issues' "blocked by" suffice for the post-merge cascade?
4. **pi as app-server.** Does pi expose a session/turn API equivalent to `codex app-server` (max_turns, streaming, resume by session id, stall detection)? If not, what is the minimal wrapper?
5. **Snapshot cadence and cost.** Nightly image rebuild vs Ramp's 30-min: what is the cold-start target (<10 s?) and the VM $/day at expected concurrency (1-3 workers)?
6. **CI rounds and retry budget.** Adopt Stripe's 2-round cap and Symphony's backoff verbatim? What is the per-issue $ cap after which the run is Released back to the human?
7. **Which slop metrics and thresholds gate a merge?** Pick a subset of the 41 (duplication share, cyclomatic max, files >350 lines, propagation cost) and decide alarm-on-inflection vs hard block. Need a TS-compatible detector (SCB is Python-only).
8. **Review-agent shape.** Two personas (correctness, maintainability) with P0/P2 severity and a suppression list; is a cheap grader stage worth it at solo volume, or is a 30-PR golden set enough to tune one prompt?
9. **Program-design artifacts as a hard gate?** Reject plans lacking call-stack trees / file-tree diffs for control-flow changes, or leave to human judgment at intake?
10. **Internal SlopCodeBench.** Which 2-4 checkpointed problems, shaped like our real product, and how often do we re-run (every harness change vs weekly)?
11. **Identity.** One GitHub App for the bot with a per-run installation token; are there cases where the solo dev wants to bypass, and do we forbid that structurally?
12. **Egress policy.** Allowlist contents for the worker VM (package registries, GitHub, model API, tracker) and how test fakes/record-replay stand in for the 1-2 external services.
13. **Budget.** Is $20-50/day real? Fusion-style routing (frontier decider + cheap executor) needs a measured $/merged PR baseline first.
14. **Skill loop.** Manual weekly distillation from pi logs vs an automated nightly pass; what is the eval that decides a skill change lands?

---

## 7. Cross-links

**Runtime / sandbox (theme A).** Pick pi for the same reason Ramp/WorkOS picked OpenCode: server-first, clients cheap. Requirements from the field: one VM per issue from a cron-built snapshot (<10 s), reused across attempts, lifecycle hooks `after_create / before_run / after_run / before_remove` (Symphony), egress allowlist proxy (WorkOS), no prod creds, QA-only (Stripe), tracker credentials not inherited by the child process (Symphony), full local observability for the agent (logs, DB, preview URL, headless browser — Ramp/OpenAI), a "verification flavor" sandbox that acts as a real client (WorkOS/StrongDM). Compaction boundary is the natural model-switch point (Fusion).

**Control plane / process (theme B).** Orchestrator lives outside the sandbox, is stateless across restarts, and treats the tracker as truth (Symphony). Intake router assigns lane (L3/L4/L5) and process tier (oneshot / single plan doc / four-phase). Upstream pipeline = product review -> architecture -> program design -> slice plan, each a pi command emitting a markdown artifact under `docs/` (Dex + OpenAI exec-plans). Pipeline shape = Stripe blueprint: `[restore] -> (implement) -> [lint/format/typecheck] -> [push] -> CI -> (fix once) -> [push] -> draft PR w/ validation table`. Post-merge cascade unblocks dependents (WorkOS). Off-hours GC and maintenance loops with capped open PRs (OpenAI/Uber). Weekly skill distillation from logs.

**Validation / versioning (theme C).** Deterministic blockers: lint with remediation text, layer/dependency lints, 350-line cap, scope check (files vs declared), diff-size budget, reverse-classical test check, test-file edits diffed separately, held-out scenarios outside the repo, coverage delta for generated tests, slop-metric trajectory alarms. Non-blocking: rubric review agent with blockers/non-blockers (FrontierCode), grader + suppression (uReview). Versioning: `WEATHER.md` for model routing, `docs/golden-principles.md` for GC, `SKILL-CHANGELOG`, exec plans with progress logs so a resumed session picks up, and an internal checkpointed benchmark run on every harness/prompt/model change. Outcome telemetry per PR (lane, cost, reviewed?, reverted?, churn, incidents) is the dataset nobody in the corpus publishes.

---

## 8. Best quotes

1. "Humans steer. Agents execute." — OpenAI Frontier `[blogs/openai-harness-engineering.md]`
2. "The only fundamentally scarce thing is the synchronous human attention of my team." — Ryan Lopopolo `[blogs/openai-harness-engineering.md]`
3. "Without the platform underneath, the AI Software Factory is a set of scripts that break the first time a repo moves or a model changes." — Port on Uber `[blogs/uber-software-factory.md]`
4. "It's not about, can we build? ... It's more of a question of, should we build it?" — Adam Huda, Uber `[blogs/uber-software-factory.md]`
5. "Tests give you feedback in seconds, but the cost function of bad architecture is measured in weeks, months, maybe even years." — Dex Horthy `[blogs/dexhorthy-2080697380379427275.md]`
6. "You don't have too many PRs. You have too many bad PRs." — Dex Horthy `[blogs/dexhorthy-article-2081058573556306030.md]`
7. "Throughput measures what was shipped, not what survived." — Faros `[blogs/faros-whiplash-report.md]`
8. "Code must not be written by humans. Code must not be reviewed by humans." — StrongDM charter `[blogs/strongdm-lights-off.md]`
9. "Over a thousand pull requests merged each week at Stripe are completely minion-produced, and while they're human-reviewed, they contain no human-written code." — Stripe `[blogs/company-factories-ramp-stripe-workos-brex.md]`
10. "You write a spec. You argue with it about the spec... Then you leave for 12 hours, and check to see if the tests pass." — Dan Shapiro `[blogs/dan-shapiro-five-levels.md]`
