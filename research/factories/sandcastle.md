# Sandcastle

- **URL:** https://github.com/mattpocock/sandcastle (npm: `@ai-hero/sandcastle`)
- **Type:** factory (orchestration library + sandbox layer; ships factory templates)
- **Author/Org:** Matt Pocock (AI Hero / Total TypeScript)
- **Researched:** 2026-08-26
- **Status/maturity:** 7,674 stars, 796 forks, 139 open issues. Created 2026-03-17; last push 2026-06-29 (v0.12.0). Releases roughly weekly through June (v0.7.0 2026-05-30 → v0.12.0 2026-06-29). Pre-1.0, MIT. Most recent commits are merges of `agent/issue-NNN-*` branches, i.e. the repo is largely maintained by its own agent workflows. Commit activity appears to have paused after 2026-06-29 (no pushes in July/August as of research date).

## One-paragraph summary

Sandcastle is a TypeScript library that turns "run a coding agent unattended" into a single function call: `sandcastle.run({ agent, sandbox, promptFile })`. It boots an isolated sandbox (Docker, Podman, Vercel Firecracker microVM, Daytona, or `noSandbox()`), hands the agent a git worktree on a chosen branch, streams the agent's JSONL output, detects a completion signal (`<promise>COMPLETE</promise>`), optionally extracts schema-validated structured output from an XML tag, captures the agent's session file so it can be resumed or forked later, and returns the commits that landed. It is deliberately unopinionated about workflow: you write the prompts and the orchestration loop in plain TypeScript, and Sandcastle supplies the sandbox/branch/session plumbing. Matt Pocock uses it as the execution engine of his personal "software factory" (a planner → parallel implementers → per-branch reviewer → merger loop, plus GitHub-Actions workflows triggered by issue labels), and the repo itself is dogfooded: most PRs are opened by the `agent:implement` workflow.

## Core ideas / thesis

- **Problem:** Running AFK ("away from keyboard") coding agents safely and repeatably requires a lot of boring plumbing: isolation, branch management, prompt templating, output parsing, session capture, timeouts, merge-back. Everybody rebuilds it badly.
- **Stance:** Provide the plumbing as a *library*, not a framework. "You write the prompt, and the engine executes it — no opinions about workflow, task management, or context sources are imposed." Workflow = a TS script you own.
- **Isolation is via git worktrees + sandboxes, not via file sync.** For bind-mount providers (Docker/Podman) the host worktree is mounted into the container, so the agent writes straight to the host filesystem through the mount and commits land on a real host branch. Isolated providers (Vercel/Daytona) sync in and pull commits out.
- **Agents are swappable** (`claudeCode()`, `codex()`, `pi()`, `cursor()`, `opencode()`, `copilot()`), but Claude Code is the primary/default (default model bumped to `claude-opus-4-8` on 2026-06-20; Dockerfile installs Claude Code CLI).
- **Sessions are first-class.** Every iteration's agent session JSONL is captured to the host; `result.resume(prompt)` and `result.fork(prompt)` let you continue or fan out from an agent's context without re-doing work. Structured-output retries reuse the same session.
- **The "day shift / night shift" model** (from Pocock's tweets): humans do `/grill-me` → `/to-prd` → `/to-issues` (vertical-slice tickets) and label them `ready-for-agent` during the day; at night a planner agent reads all tickets, decides what's unblocked, and parallel implementers + reviewers + a merger work through them.
- Vocabulary is enforced via `CONTEXT.md` (a glossary with "Avoid:" lists) and `docs/adr/` (20 ADRs). Agents are told to read both before editing. This is an explicit technique from his `mattpocock/skills` (`/grill-with-docs`).

## Architecture & mechanics

### Package layout (main branch)

```
src/
  run.ts, createSandbox.ts, createWorktree.ts, interactive.ts   # public entry points
  Orchestrator.ts          # iteration loop, completion signal, timeouts
  AgentProvider.ts         # claudeCode/codex/pi/cursor/opencode/copilot command builders + JSONL parsers
  SandboxProvider.ts, SandboxFactory.ts, SandboxLifecycle.ts
  sandboxes/{docker,podman,vercel,daytona,no-sandbox}.ts
  WorktreeManager.ts       # .sandcastle/worktrees/<branch>, locking (ADR 0007)
  PromptResolver.ts, PromptPreprocessor.ts, PromptArgumentSubstitution.ts   # {{KEY}} + !`cmd`
  Output.ts, extractStructuredOutput.ts   # Output.object({tag, schema, maxRetries})
  SessionStore.ts          # capture ~/.claude/projects/<cwd>/<id>.jsonl (+ subagents/) to host
  syncIn.ts, syncOut.ts    # isolated providers
  Display.ts, AgentStreamEmitter.ts, TextDeltaBuffer.ts   # terminal UI / log-to-file
  InitService.ts, templates.ts, templates/{blank,simple-loop,sequential-reviewer,parallel-planner,parallel-planner-with-review}/
  cli.ts                   # sandcastle init | docker build-image | podman build-image ...
.sandcastle/               # the repo's OWN factory config (dogfood)
  Dockerfile, CODING_STANDARDS.md, run.ts, plan-prompt.md, implement-prompt.md, review-prompt.md, merge-prompt.md
  agent-workflows/{explore,implement,implement-pr,review,update-branch}/{*.ts,prompt.md,extraction.md}
.factory/                  # entry points for Pocock's separate (private) "factory daemon"
  implement-task.ts, implement-prompt.md, review-prompt.md, run-daemon.sh
.github/workflows/agent-{explore,implement,implement-pr,review,update-branch}.yml
docs/adr/0001..0020-*.md   # architecture decision records
docs/agents/{domain,issue-tracker,triage,adding-an-agent-provider,adding-an-issue-tracker}.md
.out-of-scope/*.md         # explicit "we will not build this" docs, referenced when closing issues
CONTEXT.md                 # domain glossary
CLAUDE.md, AGENTS.md
```

Built on Effect-ts (services injected as `Context.Tag`s; the "agent invoker" seam lets tests substitute a fake agent). Effect is a peer dependency, which reviewers flag as a learning-curve cost.

### The primitive: `run()`

```ts
import { run, claudeCode, Output } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

const result = await run({
  agent: claudeCode("claude-opus-4-8"),
  sandbox: docker(),                       // podman() | vercel() | daytona() | noSandbox()
  promptFile: ".sandcastle/prompt.md",     // or prompt: "inline" (no templating)
  promptArgs: { ISSUE_NUMBER: 42 },        // {{ISSUE_NUMBER}} substitution
  maxIterations: 10,                       // loop until <promise>COMPLETE</promise> or limit
  completionSignal: "<promise>COMPLETE</promise>",   // default; can be array
  idleTimeoutSeconds, completionTimeoutSeconds,       // ADR 0019
  output: Output.object({ tag: "plan", schema: z.object({...}), maxRetries: 2 }),
  resumeSession: "abc-123",                // continue a prior session (1 iteration only, ADR 0011)
  hooks: { host: { onWorktreeReady: [...] }, sandbox: { onSandboxReady: [{ command: "npm install", timeoutMs: 300_000 }] } },
  copyToWorktree: ["node_modules"],
  logging: { type: "stdout" } | { type: "file", onAgentStreamEvent },
  name: "Implementer #42",
});
result.iterations   // [{ sessionId, usage, ... }]
result.commits      // [{ sha }]
result.branch
result.output       // typed, if Output.object used
result.resume?.("Now implement the plan")   // same session id, mutates JSONL
result.fork?.("Audit auth", { branchStrategy: { type: "branch", branch: "review-b" } })
```

### Branch strategies (set on the provider or on `run()`)

| Strategy | Behaviour |
|---|---|
| `{ type: "head" }` | Agent writes directly in host working dir (default for bind-mount providers). |
| `{ type: "merge-to-head" }` | Temp branch in a worktree; merged back to HEAD when done; temp branch deleted. |
| `{ type: "branch", branch: "sandcastle/issue-42", baseBranch? }` | Commits land on a named branch in `.sandcastle/worktrees/`. Re-running with the same branch **reuses the worktree** and fast-forwards from origin when safe (ADR 0003) — this makes "re-plan the same issue → same branch name → accumulated progress preserved" possible. |

`createWorktree()` and `createSandbox()` expose the same lifecycle as reusable handles (`await using` disposes them). `createSandbox()` lets you do implement-then-review in the *same* container (as `.sandcastle/run.ts` does). `sandbox.exec()` runs arbitrary commands in the sandbox (added v0.10).

### Prompt system (only for `promptFile`)

- `{{KEY}}` substituted from `promptArgs` on the host; unknown keys error, unused keys warn.
- `` !`command` `` shell expressions run **inside the sandbox**, in parallel, *after* `onSandboxReady` hooks, so they see installed deps. Non-zero exit fails the run. Values passed via `promptArgs` are inert (a `` !`…` `` inside an issue title is never executed) — this is the injection defence.
- Built-ins: `{{SOURCE_BRANCH}}`, `{{TARGET_BRANCH}}`.
- Inline `prompt:` strings get no processing at all (ADR 0008).

### Completion & timeouts

- Agent must literally print the completion signal; the engine never injects that instruction into the prompt.
- `idleTimeoutSeconds` (no output at all → fail) vs `completionTimeoutSeconds` (signal seen, process hangs because a child `gh`/MCP server kept the stdout pipe open → resolve successfully with a warning; default 60s). ADR 0019.

### Structured output

`Output.object({ tag, schema })` — agent emits JSON inside `<tag>…</tag>`; Sandcastle validates against any Standard Schema validator (Zod, Valibot, ArkType). Requires `maxIterations: 1`. On failure throws `StructuredOutputError` carrying `sessionId` so you can resume with a correction. `maxRetries` automates that loop (resume same session, feed back a token-efficient error description). The repo's own workflows use a two-step **produce-then-extract** pattern (`.sandcastle/agent-workflows/shared/run-with-extraction.ts`): run the working prompt, then `resumeSession` with a tiny `extraction.md` ("Emit a single `<output>` block… Do not change files. Do not run commands.") so the JSON emission is separated from the work.

### Session capture / resume / fork

After each iteration Sandcastle copies `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` (plus `subagents/agent-*.jsonl` for Agent-tool transcripts) out of the sandbox, rewriting `cwd` fields to the host path so `claude --resume <id>` works natively. `resume()` = `claude --resume`; `fork()` = `claude --resume <id> --fork-session` (session-only, NOT branch isolation — ADR 0018; concurrent forks need distinct `branch` strategies).

### Sandbox image

`.sandcastle/Dockerfile`: `node:22-bookworm` + git/curl/jq/gh, renames `node` user to `agent` with host UID/GID via build args (ADR 0014, no runtime chown), installs Claude Code via `curl -fsSL https://claude.ai/install.sh | bash`, `ENTRYPOINT ["sleep","infinity"]`. Worktree is bind-mounted at `/home/agent/workspace`. Auth via `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) or `ANTHROPIC_API_KEY` in `.sandcastle/.env`.

### The actual control loop (`.sandcastle/run.ts` = `parallel-planner-with-review` template)

```
for iteration in 1..MAX_ITERATIONS (10):
  1. PLAN   run(Planner, plan-prompt.md)           # one agent, docker, reads `gh issue list --label ready-for-agent`
            parse <plan>{"issues":[{number,title,branch}]}</plan>; if empty → exit
  2. EXEC   for each issue, max 4 in parallel (hand-rolled semaphore):
              sandbox = createSandbox({ branch: issue.branch, copyToWorktree:["node_modules"],
                                        hooks.sandbox.onSandboxReady: "npm install && npm run build" })
              r = sandbox.run(Implementer, implement-prompt.md, {TASK_ID, ISSUE_TITLE, BRANCH})
              if r.commits.length > 0: sandbox.run(Reviewer, review-prompt.md, same args)   # same container
  3. MERGE  run(Merger, merge-prompt.md, maxIterations:10, {BRANCHES, ISSUES})
            # agent does `git merge <branch> --no-edit`, resolves conflicts, runs typecheck+test, closes issues
```

The planner prompt (`.sandcastle/plan-prompt.md`) is the interesting part: it builds a **dependency graph** among open issues ("B is blocked by A if B needs code A introduces, they touch overlapping files, or B depends on an API shape A establishes"), emits only unblocked issues, assigns deterministic branch names `sandcastle/issue-{number}`, refuses PRDs that have child issues, and if everything is blocked picks the single weakest-dependency candidate.

### The GitHub-Actions "label-driven" factory (`.github/workflows/agent-*.yml`)

This is a second, CI-hosted factory that runs with `noSandbox()` inside the Actions runner:

- `agent-implement.yml` — trigger: issue labeled `agent:implement`. Steps: detect issue shape (refuse sub-issues and PRD-shaped issues via GraphQL `parent` / `sub_issues`), preflight for existing collaborator PRs, transition labels (`agent:implement` → `agent:in-progress`), checkout main, compute branch `agent/issue-<n>-<slug>`, `npm ci && npm run build`, `npm install -g @anthropic-ai/claude-code`, `npx tsx .sandcastle/agent-workflows/implement/implement.ts`, `git push --force`, open **draft PR** "Closes #n", add label `agent:review`. On failure: label `agent:blocked` and comment with `failure_reason.txt` + run URL; "Re-add `agent:implement` to retry."
- `implement.ts` fails the job if `git rev-list --count main..HEAD` is 0 ("Agent finished but no commits were made").
- `agent-review.yml` — trigger label `agent:review`; `review.ts` fetches PR context (diff, linked issue, review-thread comment GraphQL ids), runs the reviewer with **produce-then-extract**, filters inline comments to lines actually in the diff, writes `review_payload.json` (a GitHub review with `event: COMMENT`), `replies.json`, `verdict.txt` (`improved` if the reviewer committed, else `clean`). Reviewer is told: "Your job is not just to comment. Actively improve the branch… Address / Decline / Defer" human threads.
- `agent-update-branch.yml` — resolves merge conflicts: wrapper runs `git merge origin/main --no-edit`, agent gets `git status` + `git diff --name-only --diff-filter=U` and is told "Always resolve. Do not abort… Investigate intent on both sides with `git log -p --follow`… Do not invent new behaviour."
- `agent-explore.yml` — exploration/triage.
- Repo `.claude/settings.json` pre-allows `gh issue create/view`, `git add/status/commit`, `npm run typecheck`, `git merge sandcastle/*`.

### `.factory/` — the private daemon's hooks

`run-daemon.sh` = `cd ~/repos/ai/software-factory && pnpm run build && factory daemon`. `implement-task.ts` documents the contract: the daemon spawns it once per task with env `FACTORY_REPO_PATH, FACTORY_BRANCH, FACTORY_BASE (e.g. origin/main or origin/<parent> — stacked branches), FACTORY_TASK_ID, FACTORY_TASK_DESCRIPTION, FACTORY_TASK_ISSUE_NUMBER`; script creates a worktree with `branchStrategy: {type:"branch", branch, baseBranch: base}`, a docker sandbox, runs Implementer then Reviewer, exits 0/1; "Commits landed on FACTORY_BRANCH will be pushed and opened as a PR automatically." The `mattpocock/software-factory` repo is still 404 (private) as of research date.

## Workflow: end to end

1. **Spec (human, day shift).** `/grill-me` or `/grill-with-docs` (from `mattpocock/skills`) interrogates the idea; `/to-prd` writes a PRD as a GitHub issue; `/to-issues` splits it into vertical-slice sub-issues. Triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix` (`docs/agents/triage.md`). Domain vocabulary lives in `CONTEXT.md`; decisions in `docs/adr/`.
2. **Plan (agent).** Planner reads `gh issue list --label ready-for-agent`, computes dependency graph, emits `<plan>` JSON of unblocked issues with deterministic branch names.
3. **Implement (agent, sandboxed, parallel ≤4).** Per issue: worktree on `sandcastle/issue-N`, docker container, `npm install && npm run build` hook, prompt = issue + last 10 commits + "EXPLORATION → EXECUTION (RGR: RED write one test, GREEN, REPEAT, REFACTOR) → FEEDBACK LOOPS (`npm run typecheck && npm run test`) → COMMIT (`RALPH:` prefix, task + PRD ref + key decisions + files + blockers)". "ONLY WORK ON A SINGLE TASK." Ends with `<promise>COMPLETE</promise>`.
4. **Review (agent, same container).** Only if commits were made. Reviewer prompt gets `gh issue view`, `git diff main..HEAD`, `@.sandcastle/CODING_STANDARDS.md`; may refactor for clarity, must preserve behaviour, commits `RALPH: Review - …` or does nothing.
5. **Merge (agent).** Merger merges each completed branch into the current branch, resolves conflicts, runs typecheck/test per branch, closes issues and any parent PRDs that are now complete.
6. **Loop** up to 10 iterations until the planner returns no issues.
7. **CI variant:** label `agent:implement` → draft PR → label `agent:review` → review comments/commits → human merges (or `agent:update-branch` if conflicts).

## Notable techniques worth stealing

- **Deterministic branch names + worktree reuse** (`sandcastle/issue-{n}`, ADR 0003): re-running the plan resumes progress instead of starting over. Cheap idempotency.
- **Planner builds a dependency graph over the backlog and only emits unblocked work**, with an explicit tie-break rule when everything is blocked. Refuses PRD-shaped issues with children.
- **"No commits → failure"** as the cheapest acceptance gate (`implement.ts`). Combined with "`RALPH:` commit prefix carrying decisions/blockers" the git log becomes the inter-iteration memory.
- **Produce-then-extract**: do the work in one session, then resume the same session with a tiny extraction prompt that forbids tool use and demands one `<output>` block. Keeps the work prompt clean and makes structured output reliable; retries resume the session so nothing is redone.
- **Shell expressions expand inside the sandbox, and values passed as args are inert** — a real prompt-injection boundary for issue bodies.
- **Two-phase timeouts**: idle timeout before the signal (fail), completion timeout after the signal (succeed with warning). Solves the "gh/MCP child holds stdout" hang.
- **Session capture to host + `resume`/`fork`**: fan-out reviews from one shared exploration session; subagent transcripts captured too.
- **Same-container implement → review** via `createSandbox()`: the reviewer sees the exact built environment.
- **Label state machine on GitHub** (`agent:implement` → `agent:in-progress` → `agent:review` / `agent:blocked`) with refusal steps (sub-issue, PRD, existing collaborator PR) and a failure comment that says exactly how to retry.
- **Reviewer as an actor, not a commenter**: address / decline / defer human threads; inline comments filtered to diff lines; verdict `improved|clean`.
- **Conflict-resolution agent with a resolution policy** ("investigate intent on both sides via `git log -p --follow`, preserve both intents, never invent behaviour, always finish the merge").
- **`CONTEXT.md` glossary with "Avoid:" synonyms + ADRs + `.out-of-scope/` docs** — agents (and the maintainer) cite these when triaging/closing issues; keeps an agent-maintained repo coherent.
- **UID/GID alignment via Docker build-arg** so bind-mounted files share ownership without chown.
- **`.claude/settings.json` allowlist** scoped to exactly the commands the workflows need.

## Weaknesses / open questions / risks

- **Activity stalled after 2026-06-29** (139 open issues, no pushes for ~2 months at research time). Pocock's attention seems to have moved to the private `software-factory` daemon. Pre-1.0; breaking changes have shipped as patches (per codeline.co review).
- **Effect-ts peer dependency** — steep for teams that don't use Effect; public types are checked to be "Effect-free" but internals are not.
- **Docker bind-mount is the "sandbox"**: the agent has full network access and the host worktree is writable. Isolation is from *the rest of the host*, not a security boundary against exfiltration. Vercel/Daytona providers exist but Vercel has no automated tests.
- **The merge step is an agent** doing `git merge` + conflict resolution + closing issues. Powerful but the least deterministic step; nothing verifies the merged result beyond "run typecheck and test" inside the prompt.
- **No first-class gates/acceptance**: "done" = the agent printed the completion signal. Only the `commits.length` check and structured-output schema act as code-owned checks. Contrast with SSSF's gates and SwarmForge's audit gate.
- **Observability is thin**: run logs in `.sandcastle/logs/`, `onAgentStreamEvent` callback, usage per iteration. No persistent trace store.
- **`resume` is exactly one iteration** (ADR 0011) and `resumeSession` is incompatible with `maxIterations > 1` — multi-step continuation must be hand-chained.
- **Node/npm-centric templates** (Dockerfile, hooks, `npm run typecheck`) — fine for TS shops, needs rework otherwise.
- The night-shift model assumes a GitHub-issues backlog with good triage; quality of output is bounded by the quality of the `/to-issues` vertical slices.

## Fit for our agentic stack

Assuming a Claude Code–centric factory:

- **Adopt as the execution substrate** (or copy its design): `run()` over Docker/Podman with a bind-mounted worktree and a named-branch strategy is exactly the shape we need for parallel Claude Code runs on one repo. Claude Code is the first-class provider (`--resume`, `--fork-session`, subagent transcript capture, OAuth token support are all wired).
- **Adopt the prompt conventions**: `{{ARGS}}` + `` !`cmd` `` in-sandbox expansion, the `<promise>COMPLETE</promise>` convention, `Output.object()` with produce-then-extract. These map cleanly onto `claude -p --output-format stream-json`.
- **Adopt the GitHub label state machine and the refusal preflights** for our CI path; they are tracker-agnostic in spirit (Beads is also supported as an "issue tracker").
- **Adapt the planner prompt** (dependency graph over backlog) as the top of our loop, but feed it from our own tracker.
- **Add what Sandcastle lacks**: code-owned gates after each run (typecheck/test/lint executed by the orchestrator, not just requested in the prompt), a persistent trace (SQLite like SSSF), and a deterministic merge step (orchestrator does `git merge`; only escalate conflicts to an agent with the `update-branch` prompt).
- **Skip**: Effect-ts if we write our own; the Vercel provider unless we need cloud burst. Consider `noSandbox()` only inside an already-isolated CI runner.
- **Risk to manage**: project looks dormant — treat it as a reference implementation we can vendor/fork rather than a dependency we track.

## Related resources mentioned

- `mattpocock/skills` (237k stars) — `/grill-me`, `/grill-with-docs`, `/to-prd`, `/to-issues`, `/triage`, TDD skill; the "day shift" half of the factory. https://github.com/mattpocock/skills
- `mattpocock/software-factory` — the private daemon that spawns `.factory/implement-task.ts` per task with stacked branches; watch for it going public. https://github.com/mattpocock/software-factory (404 as of 2026-08-26)
- Tweet thread "AFK agents are not a myth… day shift / night shift" — https://x.com/mattpocockuk/status/2048159313357598989
- Tweet "I built my own software factory, and I open-sourced it" — https://x.com/mattpocockuk/status/2049506712801935611 (could not fetch; x.com returns 402)
- AI Engineer Europe 2026 talk / workshop "AI Coding for Real Engineers" (grill → PRD → vertical slices → TDD → Ralph loop) — https://ai.engineer/speakers/matt-pocock ; https://www.explainx.ai/blog/matt-pocock-ai-coding-real-engineers-workshop-2026
- codeline.co repo review of Sandcastle — https://www.codeline.co/thoughts/repo-review/2026/sandcastle-orchestrate-ai-coding-agents-in-isolated-sandboxes
- Beads (dependency-aware task tracker, supported as an issue tracker in `sandcastle init`).
- `jspicher/afk-workflow` — third-party packaging of Pocock's workflow (14 skills, `once.sh`/`afk.sh`, `/afk`). https://github.com/jspicher/afk-workflow
- Vercel Sandbox (`@vercel/sandbox`, Firecracker microVMs) and Daytona as isolated providers; `docs/research/sandbox-provider-research.md` (38KB) in the repo compares providers.
- "Ralph loop" — the `RALPH:` commit prefix and `maxIterations` loop are Sandcastle's implementation of the Ralph Wiggum loop pattern; `CONTEXT.md` explicitly says *avoid* calling the tool "RALPH".
- The `superpowers` / `freecc` skill bundles — explicitly out of scope (`.out-of-scope/bundled-workflow-templates.md`, issue #627).

## Key quotes / references

- README: "You invoke agents with a single `sandcastle.run()`. Sandcastle handles sandboxing the agent with a configurable branch strategy. The commits made on the branches get merged back."
- README: "You write the prompt, and the engine executes it — no opinions about workflow, task management, or context sources are imposed."
- `.sandcastle/implement-prompt.md`: "1. RED: write one test 2. GREEN: write the implementation to pass that test 3. REPEAT until done 4. REFACTOR … Make a git commit. The commit message must: Start with `RALPH:` prefix … Blockers or notes for next iteration … ONLY WORK ON A SINGLE TASK."
- `.sandcastle/plan-prompt.md`: "assign a branch name using the exact format `sandcastle/issue-{number}` … This must be deterministic so that re-planning the same issue always produces the same branch name and accumulated progress is preserved."
- `agent-workflows/update-branch/prompt.md`: "Always resolve. Do not abort the merge… Do not invent new behaviour. Your job is reconciliation, not feature work."
- ADR 0011: "A `.resume()` call on a `RunResult` always performs exactly one iteration."
- ADR 0018: "Fork is session-only… does not isolate the branch, worktree, or sandbox."
- `.out-of-scope/built-in-agent-providers.md`: capability bar for any agent = "non-interactive run mode, prompt via stdin, a bypass-permissions flag, env-based auth, and (critically) line-delimited JSON stream events."
- Pocock (X, 2048159313357598989): day shift = `/grill-me`, `/to-prd`, `/to-issues`; night shift = planner agent decides what is unblocked, AFK implementers pick up, implement, merge.

### Gaps
- Could not read the two X threads directly (HTTP 402); relied on search snippets.
- `mattpocock/software-factory` is private; daemon internals inferred only from `.factory/implement-task.ts` header comment.
- Did not read `src/Orchestrator.ts` line-by-line; loop semantics taken from README + ADRs.
