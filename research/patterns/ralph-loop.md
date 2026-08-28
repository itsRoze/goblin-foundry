# Ralph loop (Ralph Wiggum technique)

- **URL:** https://ghuntley.com/ralph/ (original, Jul 2025) · https://www.humanlayer.dev/blog/brief-history-of-ralph (Dex Horthy, Dec 2025) · https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum (Anthropic plugin) · https://github.com/ghuntley/how-to-ralph-wiggum (Huntley's fork of ClaytonFarr/ralph-playbook — "The Ralph Playbook")
- **Type:** pattern (autonomous outer loop) — sources are blog + plugin + playbook repo
- **Author/Org:** Geoffrey Huntley (originator); Dex Horthy / HumanLayer (popularizer, analysis); Anthropic (plugin); Clayton Farr (playbook)
- **Researched:** 2026-08-26
- **Status/maturity:** how-to-ralph-wiggum: 1,742 stars, 147 forks, last push 2026-01-11 (frozen snapshot of the playbook; no license declared). Anthropic ralph-wiggum plugin: lives inside anthropics/claude-code `plugins/`, maintained with the CLI (repo push 2026-08-26). Concept is ubiquitous by now: Sandcastle `maxIterations`, Pocock's `afk.sh`, ralph-orchestrator (3.1k stars, Rust), bmad-loop ("deterministic ralph-loop orchestrator"), Gas Town/Beads all cite it.

## One-paragraph summary

Ralph is `while :; do cat PROMPT.md | claude ; done` — an agent restarted forever with the *same* prompt, where the only state that carries across iterations is what lands on disk (files, the plan file, git history). Each iteration is a fresh context window that reads the spec + plan, picks the single most important item, implements it, runs the project's backpressure (tests/typecheck/lint/build), updates the plan file, commits, and exits. The loop's "intelligence" is not in the bash; it is in (a) the declarative specs, (b) a prioritized `IMPLEMENTATION_PLAN.md` that acts as shared memory between otherwise isolated runs, (c) backpressure that rejects bad work, and (d) "signs" — prompt guardrails added reactively every time Ralph fails in a specific way. Huntley's framing: "deterministically bad in an undeterministic world"; failures are predictable, so you tune them out. Anthropic's plugin reimplements the loop *inside* one session via a Stop hook that re-injects the prompt, which Dex argues "misses the key point of ralph ... carve off small bits of work into independent context windows."

## Core ideas / thesis

- **One context window = one task.** The 200k window is ~176k usable and the "smart zone" is 40–60% utilization; a fresh window per task keeps every iteration in the smart zone. Playbook: "Tight tasks + 1 task per loop = 100% smart zone context utilization."
- **Disk is memory.** `IMPLEMENTATION_PLAN.md` persists between iterations and is the scheduler's queue; `AGENTS.md` holds operational learnings (build/test commands, ~60 lines, "operational only"); `specs/*.md` hold requirements (one per JTBD "topic of concern"). Same files loaded every iteration → deterministic starting state.
- **Backpressure, not supervision.** Steer *upstream* (specs, existing code patterns, utilities in `src/lib`) and *downstream* (tests, typecheck, lint, build; LLM-as-judge for subjective criteria). "Prompt says 'run tests' generically; AGENTS.md specifies actual commands."
- **Let Ralph Ralph.** Trust eventual consistency; the human "sits on the loop, not in it." Tune reactively: "Each time Ralph does something bad, Ralph gets tuned" (add a sign).
- **The plan is disposable.** When Ralph goes in circles, regenerate the plan with one Planning-mode loop rather than hand-fixing.
- **Greenfield bias.** Huntley: "There's no way in heck would I use Ralph in an existing code base." Dex's brownfield adaptation: "make the change set manageable" — one small refactor per night beats 50.
- **Code is cheap.** "The easier alternative to 'merge/rebase' is just to re-run the ralph loop" on fresh main.
- **Overbaking.** Leave it running too long and "you end up with all sorts of bizarre emergent behavior" — hence max-iterations and small nightly batches.

## Architecture & mechanics

### Loop shape (three variants)

**1. Huntley original / Playbook `loop.sh`** — outer bash loop, fresh process per iteration:

```bash
# files/loop.sh — ./loop.sh [plan] [max_iterations]
while true; do
  [ $MAX_ITERATIONS -gt 0 ] && [ $ITERATION -ge $MAX_ITERATIONS ] && break
  cat "$PROMPT_FILE" | claude -p --dangerously-skip-permissions \
      --output-format=stream-json --model opus --verbose
  git push origin "$CURRENT_BRANCH" || git push -u origin "$CURRENT_BRANCH"
  ITERATION=$((ITERATION + 1))
done
```
Mode switch: `./loop.sh plan 5` uses `PROMPT_plan.md` (gap analysis → plan only, no commits); `./loop.sh 20` uses `PROMPT_build.md`. Stop = max iterations or Ctrl-C; there is no sentinel in the original.

**2. Anthropic `ralph-wiggum` plugin** — same session, Stop hook re-injects the prompt:

- `/ralph-loop "<prompt>" --max-iterations N --completion-promise "TEXT"` runs `scripts/setup-ralph-loop.sh`, which writes `.claude/ralph-loop.local.md` with YAML frontmatter (`iteration`, `max_iterations`, `completion_promise`) followed by the prompt text.
- `hooks/stop-hook.sh` (registered via `hooks/hooks.json` on the `Stop` event) reads the state file; if `iteration >= max_iterations` → delete state, allow exit. Else it extracts the last assistant message from the transcript JSONL, pulls the first `<promise>…</promise>` tag (perl, whitespace-normalized) and compares it literally to `completion_promise`; match → delete state, exit. Otherwise it bumps `iteration` and emits `{"decision":"block","reason":<prompt text>,"systemMessage":"🔄 Ralph iteration N | To stop: output <promise>X</promise> (ONLY when statement is TRUE - do not lie to exit!)"}`.
- `/cancel-ralph` deletes the state file. Command prompt adds: "CRITICAL RULE: If a completion promise is set, you may ONLY output it when the statement is completely and unequivocally TRUE."
- README caveats: exact-string match means one completion condition only ("cannot use it for multiple completion conditions like SUCCESS vs BLOCKED"); "Always rely on `--max-iterations` as your primary safety mechanism." Dex's critique: "dies in cryptic ways unless you have `--dangerously-skip-permissions`", state in an opaque markdown file, deleting it mid-loop breaks the session, and — the real one — it does not reset context.

**3. Sentinel-in-stdout variants (Pocock/afk.sh, Sandcastle)** — outer loop, fresh process, stops on `<promise>NO MORE TASKS</promise>` / `<promise>COMPLETE</promise>` in the final `result` event. See `afk-workflow.md` and `factories/sandcastle.md`.

### File layout (Playbook)

```
project-root/
├── loop.sh                  # outer loop
├── PROMPT_build.md          # build-mode instructions
├── PROMPT_plan.md           # plan-mode instructions
├── AGENTS.md                # operational guide, ~60 lines, loaded each iteration
├── IMPLEMENTATION_PLAN.md   # prioritized bullet list, Ralph-owned, disposable
├── specs/                   # one spec per JTBD topic of concern
└── src/lib/                 # "standard library" of shared utils Ralph should reuse
```
Huntley's CURSED project used `@fix_plan.md`, `@AGENT.md`, `specs/stdlib/*`, and git tags `0.0.N` bumped whenever build+tests are green.

### PROMPT_build.md (verbatim shape)

```
0a. Study `specs/*` with up to 500 parallel Sonnet subagents to learn the application specifications.
0b. Study @IMPLEMENTATION_PLAN.md.
0c. For reference, the application source code is in `src/*`.

1. Your task is to implement functionality per the specifications using parallel subagents. Follow
   @IMPLEMENTATION_PLAN.md and choose the most important item to address. Before making changes,
   search the codebase (don't assume not implemented) using Sonnet subagents. You may use up to 500
   parallel Sonnet subagents for searches/reads and only 1 Sonnet subagent for build/tests. ...
2. After implementing functionality or resolving problems, run the tests for that unit of code ... Ultrathink.
3. When you discover issues, immediately update @IMPLEMENTATION_PLAN.md with your findings using a subagent.
4. When the tests pass, update @IMPLEMENTATION_PLAN.md, then `git add -A` then `git commit` ... After the commit, `git push`.

99999. Important: When authoring documentation, capture the why — tests and implementation importance.
999999. Important: Single sources of truth, no migrations/adapters. If tests unrelated to your work fail, resolve them as part of the increment.
9999999. As soon as there are no build or test errors create a git tag. ... start at 0.0.0 and increment patch by 1 ...
999999999. Keep @IMPLEMENTATION_PLAN.md current with learnings using a subagent — future work depends on this ...
9999999999. When you learn something new about how to run the application, update @AGENTS.md using a subagent but keep it brief.
999999999999. Implement functionality completely. Placeholders and stubs waste efforts and time redoing the same work.
9999999999999. When @IMPLEMENTATION_PLAN.md becomes large periodically clean out the items that are completed ...
999999999999999. IMPORTANT: Keep @AGENTS.md operational only — status updates and progress notes belong in `IMPLEMENTATION_PLAN.md`. A bloated AGENTS.md pollutes every future loop's context.
```
Conventions: Phase 0 = orient (study specs, plan, source); Phase 1–4 = task/validate/commit; `999…` numbering = guardrails, more nines = more critical (Huntley's "signs"). Key phrasings Huntley insists on: "study" (not "read"), "don't assume not implemented" ("the Achilles' heel"), "up to N parallel subagents", "only 1 subagent for build/tests", "Ultrathink", "capture the why".

**PROMPT_plan.md**: study specs + `src/lib/*` + existing plan ("it may be incorrect"), compare code against specs with up to 500 Sonnet subagents, have an Opus subagent prioritize and rewrite `IMPLEMENTATION_PLAN.md` as a bullet list; "Plan only. Do NOT implement anything. Do NOT assume functionality is missing; confirm with code search first." Ends with an `ULTIMATE GOAL: …` line.

### Build-iteration lifecycle (Playbook)
Orient (subagents study specs) → read plan → select most important task → investigate relevant `src` ("don't assume not implemented") → implement (N subagents for file ops) → validate (1 subagent for build/tests) → update `IMPLEMENTATION_PLAN.md` (done + discoveries) → update `AGENTS.md` if operational learning → commit → exit → context cleared.

## Workflow: end to end

1. **Define requirements** (human ↔ LLM conversation): identify Jobs-to-be-Done, split into topics of concern ("one sentence without 'and'"), have a subagent write `specs/<topic>.md` per topic.
2. **Plan loop**: `./loop.sh plan` (usually 1–2 iterations) → `IMPLEMENTATION_PLAN.md`.
3. **Build loop**: `./loop.sh 20` on a branch, in a sandbox (needs `--dangerously-skip-permissions`; "a sandbox becomes your only security boundary").
4. **Observe and tune**: watch early iterations; every repeated failure becomes a sign in PROMPT or AGENTS.md, or a utility in `src/lib` ("signs aren't just prompt text — anything Ralph can discover").
5. **Regenerate plan** when Ralph goes off track, plan is stale, or clutter accumulates.
6. **Morning review**: `git log`, tags; for brownfield, review the one small PR.

## Notable techniques worth stealing

- Two prompt files, one loop: `PROMPT_plan.md` (gap analysis, no commits) vs `PROMPT_build.md` (one task, commit). Mode is a CLI arg.
- `IMPLEMENTATION_PLAN.md` as the sole cross-iteration channel, with explicit instructions to prune completed items and to log unrelated bugs found along the way.
- `AGENTS.md` is *operational only*, and the prompt itself polices that ("a bloated AGENTS.md pollutes every future loop's context").
- "don't assume not implemented" + mandatory codebase search before edits — prevents duplicate implementations, the most common Ralph failure.
- Parallelism budget in the prompt: many subagents for read/search, exactly one for build/test (avoids racing test runners and keeps backpressure serialized).
- Git tag on every green build (`0.0.N`) — cheap checkpoints for `git reset --hard`.
- Completion promise as a literal `<promise>TEXT</promise>` tag in the final message, detected by the harness, with the "do not lie to exit" instruction. Combine with a hard max-iterations.
- Escape hatches: Ctrl-C, `git reset --hard`, regenerate plan, feed a compile-error dump to a *different* model for a recovery plan (Huntley used Gemini).
- Playbook enhancements worth trying: acceptance-criteria-derived tests as backpressure; LLM-as-judge pass/fail for subjective criteria; `./loop.sh plan-work "description"` for branch-scoped plans.

## Weaknesses / open questions / risks

- Requires YOLO permissions → sandbox is mandatory (Playbook: "It's not if it gets popped, it's when").
- No sentinel in the original; stopping is human or iteration cap. Anthropic's single-promise design cannot express BLOCKED vs DONE.
- The plan file is a single mutable markdown blob: no dependencies, no atomic claims, no multi-worker safety (see `beads.md` for the answer to this).
- Overbaking / emergent weirdness on long runs; placeholder implementations ("DO NOT IMPLEMENT PLACEHOLDER…" signs exist because it happens).
- "Only one thing" is enforced by prompt alone; models routinely do more. Backpressure must be strong or Ralph commits garbage.
- Huntley's numbers (500 subagents, `--model opus`) are cost-blind; Dex's data point: 6 Sonnet loops × ~7h ≈ $10–11/h.
- Greenfield-first; for brownfield you must scope the change set per iteration (Dex's `REACT_CODING_STANDARDS.md` refactor loop).
- how-to-ralph-wiggum has no license.

## Fit for our agentic stack

pi is a better Ralph host than Claude Code because the outer loop is *supposed* to be dumb and external — pi's "YOLO by default; sandbox outside the agent" stance matches exactly.

- **Loop primitive**: `while :; do cat PROMPT_build.md | pi --mode json -p --no-session --append-system-prompt "$(cat AGENTS.md)"; done` per cloud VM. `--mode json` gives us the JSONL to detect `<promise>…</promise>` in the final assistant text (same jq filter as afk.sh) and to log per-iteration cost/turns. Use `--no-session` for true context resets, or `--session-dir <run>/sessions/` if we want post-mortem replay.
- **Adopt**: the two-prompt (plan/build) split; `IMPLEMENTATION_PLAN.md` semantics (but back it with Beads for multi-VM runs — see `beads.md`); `AGENTS.md`-is-operational-only rule; "don't assume not implemented"; single build/test subagent; tag-on-green; max-iterations as the primary stop, promise as the secondary.
- **Adapt**: replace the in-session Stop-hook variant — pi has no Stop hook but an extension could do the same (`agent_end` → re-prompt); don't. Fresh-process-per-iteration is the point and is trivial in a VM.
- **Parallelism**: pi's built-in `--tools`/`-e` flags let us give the build/test iteration a narrower tool set than the plan iteration. Subagent fan-out in pi is via spawning `pi --mode json -p` children (already in `runtime/pi.md`), so "up to 500 subagents" becomes a bounded pool we control.
- **Skip**: `--model opus` for every iteration; Anthropic's plugin; the `999…` numbering (fine for Claude, but keep signs as a plain "Invariants" section — pi shows the full prompt so we don't need cargo-cult emphasis).
- **Brownfield rule** for goblin-foundry: one loop = one scoped standards doc or one ticket, morning review of a single small PR.

## Related resources mentioned

- https://github.com/mikeyobrien/ralph-orchestrator — Rust "hat-based" Ralph orchestrator; backends include Pi; `LOOP_COMPLETE` sentinel, `.ralph/` state, PDD planning. (3.1k stars, MIT)
- https://github.com/repomirrorhq/repomirror — YC hackathon Ralph project (BrowserUse → TS overnight).
- https://github.com/dexhorthy/kustomark-ralph-bash and …-ralph-plugin — Dex's side-by-side bash vs plugin implementations.
- https://www.youtube.com/watch?v=SB6cO97tfiY — "Ralph Wiggum Showdown" (Huntley + Horthy, 2026-01-01).
- https://ghuntley.com/ralph/ references `references/sandbox-environments.md` in the playbook (Docker, Fly Sprites, E2B options).
- https://cursed-lang.org/ — the language Ralph built (3 months, greenfield proof).
- https://github.com/bmad-code-org/bmad-loop — "deterministic ralph-loop orchestrator" (see `spec-driven-methods.md`).

## Key quotes / references

- "Ralph is a Bash loop." — Huntley
- "That's the beauty of Ralph - the technique is deterministically bad in an undeterministic world." — Huntley
- "LLMs are mirrors of operator skill." — Huntley
- "Ralph should be doing all of the work ... Your job is now to sit on the loop, not in it." — Playbook
- "The IMPLEMENTATION_PLAN.md file persists on disk between iterations and acts as shared state between otherwise isolated loop executions." — Playbook
- "Waking up to one small refactor every morning is better than both a) waking up to none and b) waking up to 50." — Horthy
- "[the plugin] misses the key point of ralph which is not 'run forever' but ... carve off small bits of work into independent context windows." — Horthy on Anthropic's plugin

## Gaps

- Did not watch the AI That Works / Showdown videos; Huntley's paywalled newsletter sections of the original post were summarized secondhand via the playbook.
- ralph-orchestrator's Pi backend and cost-limit behaviour not inspected in code.
- No hard data on iteration counts vs quality; only anecdotes.
