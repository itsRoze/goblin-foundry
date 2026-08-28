# Worktree orchestrators for parallel coding agents

- **URL:** see table; index: https://github.com/andyrewlee/awesome-agent-orchestrators (200+ entries)
- **Type:** orchestration UI/TUI (task = worktree = agent session)
- **Researched:** 2026-08-26
- **Status/maturity:** category is crowded and churning; Vibe Kanban (the biggest OSS one) is sunsetting; Conductor is the Mac default; several pi-aware ones exist.

## One-paragraph summary

All of these do the same three things: (1) create a git worktree + branch per task, (2) run a coding-agent CLI in it (tmux pane, PTY, or SDK subprocess), (3) show a diff/PR/merge surface. They differ in agent coverage, whether the agent command is configurable, remote execution, and license. None targets one-VM-per-agent; all assume a shared checkout on one machine, which is the thing our design removes.

## Comparison table

| Tool | Orchestrates | Isolation model | Review UI | OSS? / license | Headless / API | pi? |
|---|---|---|---|---|---|---|
| **Conductor** (conductor.build, v0.82) | Claude Code, Codex, Cursor agents; BYO keys/subscriptions | git worktree per workspace on Mac; *cloud workspaces* on Pro+ (Vercel sandboxes, 8 vCPU/16 GB, us-east-1) | Dashboard, diff-first review, merge from UI | Closed; Free / Pro $50 / Teams $60 per user | None documented | No |
| **Vibe Kanban** (BloopAI, 27.9k stars) | 10+ executors: Claude Code, Codex, Gemini CLI, Copilot, Amp, Cursor, OpenCode, Droid, CCR, Qwen; no generic executor | git worktree per workspace (+ terminal + dev server); orphan/expired worktree cleanup (`DISABLE_WORKTREE_CLEANUP`); remote via SSH/tunnel/reverse proxy | Kanban, diff with inline comments, PR creation with AI description, built-in browser | Apache-2.0; **sunsetting** (Bloop shut down 2026-04-10; cloud features removed; community-maintained, last push 2026-04-24) | `npx vibe-kanban`; MCP server (`MCP_HOST/PORT`); no REST documented | No |
| **Claude Squad** (smtg-ai, 8.4k) | Claude Code, Codex, Gemini, Aider, OpenCode, Amp, or **any program** via `cs -p "<cmd>"` | git worktree + tmux session per task; detached background sessions | TUI: preview pane, diff tab, checkout/push before merge | AGPL-3.0; active (2026-08-20) | CLI flags `-y/--autoyes`, `-p/--program`; needs tmux + gh | Yes via `-p pi` |
| **parallel-code** (johannesjo, 1k) | Claude Code, Codex, Gemini, Copilot CLI, Antigravity CLI | worktree per task, symlinks node_modules/gitignored dirs | Electron diff viewer w/ inline comments, per-commit nav, tiled panels | MIT; active | No | No |
| **agent-orchestrator / "AO"** (Untrivial-ai, 10k) | 26 agents (Claude Code, Cursor, Copilot, Aider, Cline, Devin ...) | worktree per git-backed worker; "scratch" branchless dirs; isolated browser profiles | Kanban (Working / Needs You / In Review / Ready to Merge); PR+CI+agent-review state per worker; auto CI-fix, conflict-fix, review loops | Apache-2.0; active | daemon + optional CLI (`docs/cli`) | Not listed |
| **ensemblr** (ensemblr-hq, beta.16) | **pi (via `--mode rpc`)** and Claude Code (Agent SDK) | worktree per workspace, seeded from branch/PR/Linear issue; base fast-forwarded first | Files/Changes/Checks panel, line-anchored comments the agent can read, inline PR editor, `gh` check status, 2-step merge | Apache-2.0 (trademarked name); macOS | agent can drive the app to spawn sub-agents | **Yes** |
| **coppice** (iamfozzy) | **pi** (`@earendil-works/pi-coding-agent`) and Claude Agent SDK, each as JSON-lines Node subprocess | worktree per tab; per-worktree terminals/runners | Monaco side-by-side diffs (uncommitted + PR) | MIT; Tauri, mac/linux/win | No | **Yes** |
| pi-native: `pi-subagents` (3.3k), `pi-dynamic-workflows`, `@narumitw/pi-worktree`, `arvore-pi-extensions`, `omp-best-of` (best-of-N in worktrees + verifier), `Vocs-Pi-Control` | pi sessions | worktree per subagent inside one pi process | none / Agent Hub TUI | mixed OSS | extension API | Yes |
| Others in index: amux, dmux, herdr (tmux TUIs), Nimbalyst/Crystal (desktop), cmux, Paseo, Tempest | mostly Claude Code/Codex; some custom cmd | worktree | varies | mixed | varies | if custom cmd |

## Notable techniques worth stealing

- **Worktree hygiene** (Vibe Kanban): TTL-based sweep of orphaned/expired worktrees; `.worktreeinclude`-style copy of gitignored env files; symlink `node_modules` (parallel-code) — for VMs the analogue is snapshotting a warmed base image.
- **Seed from PR/issue** (ensemblr): workspace created *from* a PR or Linear issue with base fast-forwarded → task identity == branch identity from minute one.
- **Review comments the agent reads** (ensemblr, Vibe Kanban): line-anchored comments stored beside the workspace and injected as the next prompt — cheap version of Delta's delta-anchored comments.
- **Status columns as a state machine** (AO): Working → Needs You → In Review → Ready to Merge, with CI failure and review-requested-changes routed back to the *same* owner agent.
- **Generic program flag** (Claude Squad `-p`): any orchestrator worth using must accept an arbitrary command; the ones that hardcode executors are dead ends for pi.
- **Best-of-N in worktrees + verifier, apply winner only** (omp-best-of).

## Weaknesses / open questions / risks

- Shared-checkout assumption: worktrees share `.git`, hooks, and host resources; a runaway `rm -rf`, port collision, or `git gc` hits all agents. This is why we chose VMs.
- Hardcoded executor lists (Vibe Kanban, Conductor, parallel-code) → no pi.
- Most are GUIs; no headless control plane except AO's daemon and Claude Squad's CLI.
- Vibe Kanban's sunset shows the business-model fragility of this layer; Conductor's cloud tier ties you to Vercel sandboxes.

## Fit for our agentic stack (pi, one VM per agent)

- **Isolation: none of these needed.** VM = worktree. Keep only the *conventions*: one branch per task named `agent/<task-id>` created from a fresh-fetched base, task metadata (issue URL, session id) stored as branch description / PR body, and a sweeper that deletes stale remote branches + VMs by TTL.
- **Control plane: build thin, borrow AO's state machine.** Orchestrator holds `{task, vm, branch, session_id, pr, status}`; CI failure / review-changes events re-dispatch to the same VM (resume pi session with `--session`) rather than a new one.
- **Review surface: reuse GitHub PR + optionally ensemblr/coppice for a human "attach" view** (both speak pi natively; ensemblr's comments-the-agent-reads is the feature we want). Neither runs remote today — would need a pi-server/ACP bridge (see acp.md).
- **Local dev fallback**: Claude Squad `cs -p pi -y` is the zero-effort way to run a few pi agents in worktrees on a laptop when VMs are overkill.

## Related resources mentioned

- https://github.com/andyrewlee/awesome-agent-orchestrators — index; mine for control-plane primitives (Crewplane, omnigent, LionClaw) and task runners (sortie, Taskuary)
- https://github.com/Untrivial-ai/agent-orchestrator — closest to a full "issue → PR → merge with auto-fix" loop; read its daemon/CLI docs
- https://github.com/ensemblr-hq/ensemblr , https://github.com/iamfozzy/coppice — pi-native desktop orchestrators
- https://github.com/wolfiesch/omp-best-of — best-of-N worktrees + verifier for pi
- https://github.com/TheAhmadOsman/parallel-agent-worktree-skill — portable plan/spawn/review/merge skill incl. pi
- https://addyosmani.com/blog/code-agent-orchestra/ , https://developer.upsun.com/posts/ai/git-worktrees-for-parallel-ai-coding-agents — overview posts
