# StrongDM "Software Factory" (lights-off) + Weather Report

- **URL:** https://factory.strongdm.ai/ ; /principles ; /techniques ; /weather-report ; company post https://www.strongdm.com/blog/the-strongdm-software-factory-building-software-with-ai ; Simon Willison https://simonwillison.net/2026/Feb/7/software-factory/ ; HN https://news.ycombinator.com/item?id=49026625
- **Code:** https://github.com/strongdm/attractor — nlspec of Attractor, "a non-interactive Coding Agent sufficient for use in a Software Factory" (attractor-spec.md, coding-agent-loop-spec.md, unified-llm-spec.md), Apache-2.0, ~1.2k stars (Jun 2026)
- **Type:** factory
- **Author/Org:** StrongDM AI Lab — Justin McCarthy, Jay Taylor, Chauhan; founded 2025-07-14
- **Researched:** 2026-08-26
- **Status/maturity:** Public since Feb 2026; ~32k LOC production code by then; Weather Report updated roughly monthly; retrospectives promised at 5–6 months (not found).

## One-paragraph summary

Three engineers with a charter of "Code must not be written by humans. Code must not be reviewed by humans." and a spend floor of ~$1,000/engineer/day in tokens. The factory replaces code review with *validation*: humans write specs and curate end-to-end "scenarios" (held out of the repo), agents implement non-interactively until scenarios converge, and a "Digital Twin Universe" of cloned third-party services (Okta, Jira, Slack, Google Docs/Drive/Sheets) lets them run thousands of scenarios per hour deterministically. Success is a probabilistic "satisfaction" score, not a boolean test pass. The Weather Report is their living model-routing table. Dex Horthy calls this the canonical lights-off factory and notes no public outcome data.

## Core ideas / thesis

- "Seed -> Validation harness -> Feedback loop. Tokens are the fuel."
- Seed: "Every piece of software needs an initial seed" (PRD, screenshots, an existing codebase).
- Validation: "Your validation harness must be end-to-end, as close to the real environment as possible: customers, integrations, economics."
- Feedback: a sample of output feeds back into inputs "until holdout scenarios pass consistently."
- Fuel: "For every obstacle, ask: how can we convert this problem into a representation the model can understand?" — traces, screen captures, transcripts, incident replays, adversarial use, agentic simulation, surveys, interviews, price-elasticity tests.
- "It's what happens when validation replaces code review."
- Recurring prompt to self: "Why am I doing this?" (implied: the model should).

## Architecture & mechanics

- **Non-interactive agent (Attractor):** graph-defined pipeline; "Attractor defines the orchestration layer: graph definition, traversal, state management, and extensibility"; bring your own LLM client + coding-agent loop (both also specced). Built by pointing any agent at the spec: `codeagent> Implement Attractor as described by https://github.com/strongdm/attractor`.
- **Scenarios instead of tests:** end-to-end user stories "stored outside the codebase," functioning as holdout sets so the agent can't overfit or edit them. Scored as *satisfaction*: "what fraction of observed trajectories likely satisfy the user?" via LLM-as-judge, because agentic components are probabilistic.
- **Agent Obsession problem:** agents shortcut narrow tests ("returning `true` to pass"); fix was widening coverage to integration, regression, e2e, behavioral tests — and holdouts.
- **Digital Twin Universe (DTU):** "Clone the externally observable behaviors of critical third-party dependencies. Validate at volumes and rates far exceeding production limits, with deterministic, replayable test conditions." No rate limits, no API cost, safe to exercise dangerous failure modes.
- **Other techniques:** Gene Transfusion (point agents at concrete exemplars to move patterns between codebases); The Filesystem as memory substrate ("directories, indexes, and on-disk state"); Shift Work ("Separate interactive work from fully specified work. When intent is complete... an agent can run end-to-end without back-and-forth"); Semport (semantic ports between languages/frameworks); Pyramid Summaries (reversible multi-zoom summaries).
- **Weather Report:** "What models we're running today, how they're configured, and what role each one" plays — model x task table across 15+ use cases, reasoning-effort settings, strengths/weaknesses, update log. June 2026: "The default for everyday tasks should be gpt-5.5 on low/medium before you bump up the reasoning"; Gemini 3.5 Flash "does still sometimes end up in a tool call loop"; don't daily-drive Opus 4.8 because "it burns too many tokens."
- **Economics:** "$1,000 on tokens today per human engineer" per day (~$20k/eng/month).

## Workflow: end to end

1. Human writes the seed (spec/PRD/screens) and the scenarios; scenarios live outside the repo.
2. Attractor runs the graph non-interactively: implement -> build harness -> run scenarios against DTU -> judge satisfaction -> loop.
3. Convergence = holdout scenarios pass consistently; ship. No human reads the diff.
4. Production signals (incidents, transcripts) become new scenarios ("Fuel").
Human touchpoints: charter/strategy, seed writing, scenario curation, watching scores, model routing (Weather Report).

## Notable techniques worth stealing

- Holdout scenarios stored *outside* the repo the agent edits — the cheapest anti-reward-hacking measure available.
- Satisfaction as a fraction over trajectories rather than a red/green suite for anything LLM-driven.
- Fake-the-world (DTU) for integrations so validation is unbounded and deterministic.
- "Shift Work": only hand fully-specified work to the non-interactive lane; keep vague work interactive.
- A Weather Report file: model -> role table with reasoning level, updated when something changes.
- Spec-first tooling (nlspec): ship the agent as a spec and let the agent build it.

## Weaknesses / open questions / risks

- No published outcome data on maintainability, defect rates, or product adoption (Dex: "I haven't been able to dig up any definitive data/findings"). Stanford CodeX asks "trusted by whom?"
- Security-critical software with zero human reads (Willison flags this).
- $1k/day/engineer floor; DTU construction cost is unstated.
- LLM-as-judge satisfaction has the "ceiling" problem Dex raises.
- Scenario curation becomes the new bottleneck and the new place where bugs hide.

## Fit for our agentic stack (solo, pi, cloud VMs)

- **Adopt:** a `scenarios/` repo (or branch-protected dir the worker VM can't write) with e2e user stories; a scenario runner that reports pass-fraction; a `WEATHER.md` mapping pi roles -> model/effort.
- **Adapt:** a mini-DTU only for the 1–2 external services our product touches (record/replay or a small fake server) rather than cloning Okta.
- **Adapt:** Attractor's graph idea maps to a pi pipeline: nodes = pi invocations with fixed prompts, edges = validation outcomes. Could literally have pi implement the attractor-spec.
- **Skip:** dropping human review entirely; instead go lights-*dim*: no human review for changes whose scenarios pass and diff is small; human reads everything else.
- **Budget reality:** $1k/day is out; expect $20–50/day and use Shift Work to keep interactive spend low.

## Related resources mentioned

- https://github.com/strongdm/attractor (spec-only agent) — own research file candidate
- Stanford CodeX "Built by Agents, Tested by Agents, Trusted by Whom?" https://law.stanford.edu/2026/02/08/built-by-agents-tested-by-agents-trusted-by-whom/
- DevInterrupted "Everyone building a software factory wants the same proof" https://devinterrupted.substack.com/p/everyone-building-a-software-factory
- Signals "Dark Factory Architecture: How Level 4 Actually Works" https://signals.aktagon.com/articles/2026/03/dark-factory-architecture-how-level-4-actually-works/

## Key quotes / references

- "Code must not be written by humans." / "Code must not be reviewed by humans."
- "Seed -> Validation harness -> Feedback loop. Tokens are the fuel."
- "Humans define intent: what the system should do, the scenarios it needs to handle, the constraints that matter. After that, the agents take it from there."
- Jay Taylor (HN): "Almost all software problems yield to a combination of the Factory Techniques covered on the strongdm.ai website... our outlook continues to be bullish."

## Gaps

- Did not read attractor-spec.md / coding-agent-loop-spec.md in full (graph format, node types unknown).
- No retrospective/outcome article located; the 32k-LOC figure is from secondary coverage (36kr).
- Weather Report table not captured row-by-row.
