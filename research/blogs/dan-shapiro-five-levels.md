# Dan Shapiro — "The five levels from spicy autocomplete to the software factory"

- **URL:** https://www.danshapiro.com/blog/2026/01/the-five-levels-from-spicy-autocomplete-to-the-software-factory/
- **Type:** blog
- **Author/Org:** Dan Shapiro (CEO Glowforge, Robot Turtles, Wharton research fellow)
- **Researched:** 2026-08-26
- **Status/maturity:** Posted 2026-01-23; coined "dark factory"/"lights-off software factory" as now used by Dex, StrongDM coverage, HackerNoon, Signals, etc.

## One-paragraph summary

A taxonomy, modeled on NHTSA's 2013 driving-automation levels, of how teams use coding AI: 0 manual, 1 task automation, 2 copilot, 3 human-in-the-loop reviewer ("your life is diffs"), 4 spec-writer/PM who leaves for 12 hours and checks tests, 5 the Dark Factory — "a black box that turns specs into software" where humans are "neither needed nor welcome." Its framing point: each level *feels* finished, and the economic argument (his "technical deflation" post) is that the value compounds only in the upper levels. Shapiro places himself at 4 and says he knows "a handful" of sub-five-person teams at 5.

## Core ideas / thesis

- Merely using ChatGPT for quick tasks misses the deflation; the gains are in moving up levels.
- Each level plateaus: "Most developers plateau [at 2]; feels complete but isn't."
- Level 3 is the trough: "For many people, this feels like things got worse."
- Level 4 converts the engineer into a PM: "You've now become that which you loathed: you're a PM."
- Level 5 is real but rare, small-team, and "will likely be our future."

## Architecture & mechanics (the levels)

| Lvl | Name | What you do | Tooling signal |
|---|---|---|---|
| 0 | Manual | "Not a character hits the disk without your approval" | vi / VS |
| 1 | Task automation | offload unit tests, docstrings | autocomplete |
| 2 | Copilot | "pairing with the AI like a colleague"; AI does boring stuff | Cursor/Copilot |
| 3 | Reviewer | "coding agent is always running multiple tabs... Your life is diffs" | multiple agent tabs |
| 4 | Spec manager ("robotaxi") | "You write a spec. You argue with it about the spec. You craft skills (for Claude Code...). You plan schedules. You review plans. Then you leave for 12 hours, and check to see if the tests pass." | Claude Code + skills |
| 5 | Dark Factory | "a black box that turns specs into software"; Fanuc reference: "It's dark, because it's a place where humans are neither needed nor welcome." | custom factory |

Human touchpoints by level: L3 = every diff; L4 = spec, plan, skills, test results; L5 = spec in, software out. Validation gate at L4 is "do the tests pass"; at L5 unstated (StrongDM fills this in with scenarios/DTU).

## Workflow: end to end (Level 4, his own)

1. Write spec; argue with the agent about the spec until it is unambiguous.
2. Craft skills (reusable procedures) for Claude Code.
3. Plan schedule; review the agent's plan.
4. Leave for ~12 h.
5. Check test results; iterate.

## Notable techniques worth stealing

- Use the ladder as a *routing* rubric: classify each task by the lowest level it can safely be run at (L4 lane for well-specified work, L3 lane for risky, L5 only for scenario-covered).
- "Argue with it about the spec" — a spec-critique pass before any implementation.
- Skills as the unit of accumulated process at L4.
- "Leave for 12 hours" implies long-horizon runs need budgets, checkpoints, and a test-based stop condition.

## Weaknesses / open questions / risks

- Descriptive, not prescriptive: no validation architecture for L5, no data.
- L5 claims are anecdotal ("nearly unbelievable") and are exactly what Dex and Faros dispute.
- Treats "tests pass" as the L4 gate — Dex's whole argument is that test-pass is the wrong reward.

## Fit for our agentic stack (solo, pi, cloud VMs)

- Target **L4 with an L5 lane**: solo dev writes specs + scenarios; pi runs in cloud VMs overnight; the lane decides whether a human reads the diff. Tag every task in the queue with its level; log which level each merged PR ran at so we can measure defect rate per lane (Faros-style).
- Build "argue about the spec" as a mandatory pi step (spec-critic prompt) before dispatch.
- Skills: maintain `skills/` in the repo as pi extensions/prompt files; it is the L4 lever Shapiro names.

## Related resources mentioned

- NHTSA driving automation levels (framework)
- Fanuc dark factory
- Shapiro "This is a Time of Technical Deflation" (prior post) — the economics
- Noah Radford "Road-Runner Economy" (guest piece)
- Derivative: HackerNoon "The Dark Factory Pattern"; Signals "Dark Factory Architecture: How Level 4 Actually Works"

## Key quotes / references

- "Your life is diffs."
- "You write a spec. You argue with it about the spec... Then you leave for 12 hours, and check to see if the tests pass."
- "At level 5, it's not really a car any more... it's a black box that turns specs into software."
- "I know a handful of people who are doing this. They're small teams, less than five people. And what they're doing is nearly unbelievable — and it will likely be our future."

## Gaps

- Did not capture the full text of the opening/closing paragraphs or the "technical deflation" post.
