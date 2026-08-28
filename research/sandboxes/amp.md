# Amp (ampcode.com)

- **URL:** https://ampcode.com/ — docs: https://ampcode.com/docs — news/changelog: https://ampcode.com/news — chronicle: https://ampcode.com/chronicle — npm: `@ampcode/cli`
- **Type:** sandbox (orbs) + agent harness — really a full agentic coding product whose remote-execution layer ("orbs") is the sandbox part
- **Author/Org:** Amp Inc. (spun out of Sourcegraph Dec 2, 2025; CEO Quinn Slack; Thorsten Ball is the public voice; boards shared with Sourcegraph's investors Sequoia, a16z, Redpoint, Craft, Goldcrest). Amp Labs (May 2026) does enterprise engagements (e.g. Westpac).
- **Researched:** 2026-08-26
- **Status/maturity:** Closed-source, hosted (threads live on Amp's servers). Extremely fast-moving: ~weekly changelog entries; rebuilt from scratch as "Amp Neo" and relaunched as Amp on 2026-05-27; orbs launched 2026-06-30; subscriptions 2026-07-18; agent-to-agent 2026-07-17; global plugins/skills 2026-08-11; latest entry 2026-08-19 ("Pass the Orb").

## One-paragraph summary

Amp is "the frontier agent": an opinionated coding agent and development environment (CLI TUI, VS Code/Cursor/Windsurf/Zed/Neovim/JetBrains extensions, web app, iOS, Slack) that deliberately hides model choice behind a four-position "dial" (low / medium / high / ultra, each a fixed agent+oracle model pairing), runs tools **without per-action approval by default**, and stores every conversation as a server-side, shareable "thread". Since mid-2026 its center of gravity moved from the local harness to **orbs**: Debian 12 VMs Amp creates per thread (sizes a1.tiny 1 vCPU/2 GB $0.08/hr → a1.xxlarge 16 vCPU/32 GB $1.32/hr, 60 GB disk, per-minute billing, auto-pause after 5 min idle at $0), snapshotted after a repo's `.agents/setup` runs, with "portals" (authenticated URLs to dev servers inside the orb), multiplayer, scheduled wake-ups, webhook-driven wake-ups, and agent-to-agent spawning across orbs. Pricing is $20/mo (Megawatt: 750 orb-hours, $20 agent credit, low/medium, high only with a linked ChatGPT subscription) or $200/mo (Gigawatt: 1,000 xxlarge orb-hours, $200 credit, all modes), plus pay-as-you-go at API prices with zero markup and BYO ChatGPT/SuperGrok subscriptions. Thorsten Ball's thesis: "The thing we called harness for the last year is becoming less and less important… orbs and portals is what we need to focus on next."

## Core ideas / thesis

- **Frontier over stability.** "Amp is Sourcegraph's bet on the frontier: it deletes old workflows and stale assumptions so you stay close to what works now." They rip out features (Rush mode, Smart mode, model names, `--take-me-back`) as soon as something better appears.
- **No model picker; a capability dial.** You choose a budget (low/medium/high/ultra), Amp chooses models for agent, oracle, thread-reader and reviewer. "Choose the lowest mode that can plausibly solve the task in one clean run."
- **No approval prompts.** "By default, Amp does not ask for approval before running tools." Safety is meant to come from isolation (orbs, disposable envs), git branches, policy plugins, and narrowly scoped MCP credentials — not from a permission dialog.
- **Threads are the unit of work and of collaboration.** Persistent, server-stored, visibility-controlled (private/unlisted/workspace/public), resumable from any device, shareable as URLs, forkable, hand-off-able.
- **Subagents are first-class and mostly automatic**: Task subagents for parallel/isolated work, Oracle for second-opinion reasoning, Librarian for remote code search (Sourcegraph heritage), Painter for images, a dedicated review agent, a "thread reader" for reading huge threads.
- **Remote > local.** Orbs remove "checkouts, ports, browser instances, or local machine resources" as constraints; "it's in an orb, I don't give a damn how long this runs." Reframes agent output from "code to review skeptically" to "irrefutable proof" via long autonomous test runs, screenshots, and videos.
- **Everything is a plugin.** Post-Neo, tools, commands, modes, webhooks, and permission policies are TypeScript plugins running on Bun; skills follow the cross-vendor `SKILL.md` standard and Amp reads `.claude/skills` and `CLAUDE.md` for compatibility.

## Architecture & mechanics

**Install / run**
```sh
curl -fsSL https://ampcode.com/install.sh | bash      # or brew; npm package is @ampcode/cli
amp                     # interactive TUI in cwd
amp -x "prompt"         # execute (headless) mode: run one turn, print final message, exit
echo "prompt" | amp -x  # stdin prompt; redirecting stdout auto-enables -x
amp -x --stream-json "prompt"                         # JSONL events (system init, user, assistant, result)
amp -x --stream-json --stream-json-input < msgs.jsonl # drive with JSON user messages (supports steer:true, images)
amp threads continue -x "follow-up" --stream-json     # continue a thread headlessly
amp -ox "prompt" [--orb-size a1.large]                # run this turn in a fresh orb
amp sync <thread-url-or-id>                           # mirror orb changes into local checkout
amp --no-tui [--runner-id my-box] [--remote-control-terminal]   # runner: execute threads created on ampcode.com here
amp --mcp-config '{"everything":{"command":"npx","args":["-y","@modelcontextprotocol/server-everything"]}}' -x "tools?"
amp --fast / --plugin-ready-timeout [N]               # fast mode; wait for plugins before first turn (max 300 s)
AMP_API_KEY=... amp -x "..."                          # CI auth
```
Keys: `Ctrl+O` palette, `Ctrl+S` change mode, `Ctrl+G` edit prompt in `$EDITOR`, `Ctrl+R` history, `Ctrl+\` thread sidebar, `Ctrl+X` leader chords, `Alt+D` reasoning effort, `Alt+R` fast mode, `Ctrl+X P` Puck. Commands: `/mode <low|medium|high|ultra|free>`, `/new`, `/continue`, `/handoff <new objective>` (summarize context into a new thread), `queue` (queue a message while the agent works), fork-from-message, `amp update`, `amp tools list`, `amp skills list --json`, `amp config edit [--workspace]`, `amp config keymap`, `amp mcp add|approve`, `amp plugins add <url> [--target workspace]`, `amp skill add <source> [--global]`, `amp secrets ...`, `amp orb ...`.

**Modes ("the Dial", July 2026)** — fixed model routing, no picker:

| Mode | Agent model | Oracle model | Intended for |
|---|---|---|---|
| low | GLM-5.2 (open-weight) | GPT-5.6 Sol | renames, typos, precisely specified fixes |
| medium (default) | GPT-5.6 Sol (medium effort) | GPT-5.6 Sol (high) | bug fixes, scoped features, PR review |
| high | GPT-5.6 Sol (xhigh) | Claude Fable 5 | cross-cutting changes, concurrency, subtle bugs |
| ultra | Claude Fable 5 | GPT-5.6 Sol | migrations, architecture, discovery-heavy work |
| free | rotating OSS/frontier surplus tokens, ad-supported | — | `/mode free`; rate-limited |
| puck | GPT-5.6 Sol | — | meta-agent for navigating projects/threads |

With a linked ChatGPT subscription, low/medium/high use only OpenAI models (agent, oracle, thread reader, review) billed to that subscription. Historic modes (smart, rush, deep, oracle-o3) are gone. Context up to 1M tokens (Sonnet 4 era); "Read Bigger Threads" (Jul 2026) uses a thread-reader subagent for arbitrarily large threads.

**Subagents / special tools**
- **Task subagent**: spawned automatically for repo-wide searches, parallel review passes (security/correctness/tests), independent hypotheses. Isolated: no cross-talk, fresh context, main thread only sees the final summary.
- **Oracle**: "second opinion" high-reasoning model; auto-routed or invoked with "use the oracle". Advice: "Do not summon Oracle for every task."
- **Librarian**: searches remote codebases (public GitHub, private with config) — default branch only. Sourcegraph MCP is a supported server (`${SRC_ENDPOINT}/.api/mcp/v1`).
- **Painter**: GPT Image 2 for mockups/icons/redaction, up to 3 style references.
- **Agentic Review** (Dec 2025): dedicated code-review agent; **Search subagent** on Gemini 3 Flash.
- **Puck**: personal assistant across Amp — start/monitor/message agents, split a request across several agents and gather reports, create projects; reachable at `Ctrl+/` on the web, in the TUI, and as `@Amp` in Slack.
- **Agent-to-agent** (Jul 2026): an agent can "start other agents, send them instructions, exchange files, and bring their results back"; executors are orb (with size), local, or a named runner. Example prompt from docs: "Run four low-mode threads in parallel to test this flow in Chrome at four screen sizes and report back with screenshots."

**Config files & settings**
- User: `~/.config/amp/settings.json[c]`; workspace: `.amp/settings.json[c]` (searched upward); `--settings-file`; managed: `/etc/ampcode/managed-settings.json`, `/Library/Application Support/ampcode/managed-settings.json`, `%ProgramData%\ampcode\managed-settings.json`.
- Keys: `amp.mcpServers`, `amp.mcpPermissions` (`{matches:{command|args|url}, action:"allow"|"reject"}`), `amp.tools.disable`, `amp.skills.path`, `amp.skills.disableClaudeCodeSkills`, `amp.remoteThreadCreation.enabled`, `amp.defaultVisibility`, `amp.showCosts`, `amp.git.commit.ampThread.enabled`, `amp.git.commit.coauthor.enabled`, `amp.keymap`, `amp.thread.autoArchiveOnQuit`, `amp.updates.mode`, `amp.notifications.enabled`, `amp.terminal.*`, `amp.admin.compatibilityDate`. Legacy enforcement keys still honored: `amp.permissions`, `amp.guardedFiles.allowlist`, `amp.dangerouslyAllowAll`.
- Env: `AMP_API_KEY`, `AMP_DISABLE_AMP_THREAD_TRAILER=1`, `AMP_DISABLE_AMP_COAUTHOR_TRAILER=1`, `AMP_SKIP_UPDATE_CHECK=1`, `AMP_REMOTE_CONTROL_TERMINAL`, `HTTP(S)_PROXY`, `NODE_EXTRA_CA_CERTS`; inside orbs `AMP_ORB`, `AMP_THREAD_ID`, `PORT`, `PUBLIC_URL`.

**MCP**
```sh
amp mcp add context7 -- npx -y @upstash/context7-mcp
amp mcp add linear https://mcp.linear.app/sse
amp mcp approve my-server        # workspace-declared servers need explicit trust
```
```json
{ "amp.mcpServers": {
    "playwright": { "command": "npx", "args": ["-y","@playwright/mcp@latest","--headless"] },
    "linear": { "url": "https://mcp.linear.app/sse" },
    "sourcegraph": { "url": "${SRC_ENDPOINT}/.api/mcp/v1", "headers": { "Authorization": "token ${SRC_ACCESS_TOKEN}" } } } }
```
Precedence: `--mcp-config` > `.amp/settings.json` > `~/.config/amp/settings.json` > skills (`mcp.json` sibling or `mcpServers` frontmatter). **Toolboxes**: any executable that answers `TOOLBOX_ACTION=describe` / `TOOLBOX_ACTION=execute` becomes a tool without an MCP server.

**AGENTS.md** — read from cwd/workspace roots *and* all parent dirs up to `$HOME`, plus subtree `AGENTS.md` when files there are touched; user-level `~/.config/amp/AGENTS.md` / `~/.config/AGENTS.md`; system `/etc/ampcode/AGENTS.md`. Falls back to `AGENT.md` then `CLAUDE.md`. `@path` / `@~/x` / `@specs/**/*.md` mentions inline other files; YAML frontmatter `globs: ['**/*.ts']` makes a mentioned file conditional on having read a matching file.

**Skills** — `SKILL.md` with `name`/`description` frontmatter (dir name must equal `name`), sibling scripts/templates. Search order: `~/.config/agents/skills/`, `~/.agents/skills/`, `~/.config/amp/skills/`, `.agents/skills/`, `.claude/skills/`, `~/.claude/skills/`, `~/.claude/plugins/cache/`, `amp.skills.path`, built-ins, personal repo, workspace repo (local masks remote). User-invokable skills (Jan 2026); `amp skill add <src> [--global]`, `amp clone user-skills`, `reload_skills` tool; Global Plugins and Skills (Aug 2026) share across a workspace.

**Plugins (post-Neo extension model)** — TS/JS in `.amp/plugins/` (project) or `~/.config/amp/plugins/` (system), plus personal/workspace-managed; long-lived Bun processes exporting `default (amp: PluginAPI) => …`. Events: `session.start`, `agent.start` (inject context), `tool.call` (approve/reject/modify/synthesize — this is how you build a permission layer), `tool.result` (transform), `agent.end` (auto follow-up turns). APIs: `registerTool`, `registerCommand`, `registerAgentMode({key:'architect', agent: …})` (custom modes extending low/medium/high/ultra), UI dialogs, config store, `$` shell, AI helpers (generate text/structured, yes/no), `amp.createWebhook` (durable endpoints that wake orbs). Docs ship a **permissions plugin** example that AI-classifies and blocks destructive git operations.

**Orbs (the sandbox layer)**
- Debian 12 VM per thread; pre-installed: authenticated `amp` + `gh`, git, ssh, tmux, Bun/Node/npm/pnpm/yarn, Python/pip, `agent-browser`, ffmpeg, ImageMagick, jq, fzf, ripgrep, vim, websocat, etc. Underlying VMM not disclosed ("VMs, or sandboxes, or whatever you want to call them").
- Lifecycle: create → clone repo (GitHub app or public git URL, or empty) → run `.agents/setup` (≤20 min, idempotent, no personal creds, no long-running services) → **snapshot** (cached ≤72 h; reused for later threads in the project; invalidated by cache expiry, repo source change, or shared-config change — *not* by editing `.agents/setup`; manual delete in project settings) → agent runs → auto-pause after 5 min idle or on thread archive ($0 while paused) → wake on message/portal/schedule/webhook → `.agents/resume` (10 s timeout, gets fresh workload-identity creds).
- Sizes: a1.tiny 1 vCPU/2 GB $0.08/hr; a1.small 2/4 $0.17; a1.medium 4/8 $0.33; a1.large 8/16 $0.66; a1.xxlarge 16/32 $1.32; all 60 GB disk; per-minute billing; enterprise +50%. Set via `--orb-size`, the new-thread dialog, or project default.
- Secrets: workspace → project → personal (personal wins) settings or `amp secrets`; `amp orb id-token --audience <aud> [--ttl-seconds 60..3600] [--subject-scope thread|user|project|workspace]` mints RS256 OIDC tokens verifiable at `https://ampcode.com/api/workload-identity` — use for cloud/log/DB access without static keys.
- Services & portals: `.amp/services.yaml` (committed) declares dev servers; `amp orb services ensure`, `amp orb service list|status|logs|restart|stop|start <name>`, `amp orb portal <port> [--hostname x --take-over]`. Portals are authenticated `*.onamp.dev` URLs (custom domains supported), inject a review widget for annotations, pass `X-Amp-Authenticated`, `X-Amp-User-*` headers, can be made public for 1 h–7 d, and can give the agent `observe` (console logs) or `control` (drive the page, needs human approval) access.
  ```yaml
  services:
    web:
      command: pnpm dev -- --host 0.0.0.0 --port "$PORT"
      cwd: app
      health: /healthz
      env: { API_MODE: development, FRONTEND_URL: "${services.api.publicURL}" }
      agent: control
      portal: { url: /__dev/log-me-in/$AMP_USER_EMAIL?returnTo=/, title: App }
  ```
- Multiplayer (teammates join an orb thread; shared tmux), "Pass the Orb" (tag a teammate to hand over), automations (one schedule per thread; "Every morning at 9am…", agent can set its own), event-driven orbs (any HTTP request can wake an orb; Amp generates a repo-scoped webhook plugin that verifies signatures and dedupes).
- Runners: `amp --no-tui --runner-id <hostname>` makes *your* machine an executor for threads created on ampcode.com (alternative to orbs for on-prem/beefy boxes); `amp.remoteThreadCreation.enabled: true` lets a TUI instance accept remote threads; Remote Control continues a local CLI thread from web/phone (passkey enforcement available).

**Sandboxing model (summary).** Amp does **not** ship an OS-level sandbox (no Seatbelt/bubblewrap equivalent) and does not prompt for approvals. Isolation is achieved by *where you run it*: an orb (per-thread VM), a runner on a disposable machine, or a container you provide. Local policy is a `tool.call` plugin or the legacy `amp.permissions` allow/reject list; MCP servers are gated by `amp.mcpPermissions` and workspace-server approval. Docs explicitly warn: "Untrusted repositories, MCP servers, and other external inputs can influence what Amp does."

## Workflow: end to end

1. **Repo prep** (one-time): `AGENTS.md` with commands/architecture/rules (globs frontmatter for language-specific files); `.agents/setup` (`npm ci`, codegen, tool checks); optional `.agents/resume`; `.amp/services.yaml` for dev servers; `.agents/skills/*/SKILL.md` for repeatable workflows; project secrets and default orb size in Projects settings; connect GitHub.
2. **Kick off**: from the web ("New Thread → New Orb → project → prompt"), CLI `amp -ox "Implement #123 per spec.md; open a PR" --orb-size a1.medium`, Slack `@Amp …`, a schedule, or a webhook (Linear issue created → thread). First orb runs setup and snapshots; later threads start fast.
3. **Agent runs unsupervised** in the orb at the chosen dial position, spawning Task subagents for search/review, Oracle for hard reasoning, agent-to-agent orbs for parallel test matrices; starts services and posts portal links + screenshots/videos into the thread as proof.
4. **Human loop**: watch from web/phone; open the portal, annotate UI, comment; join multiplayer; `amp sync <thread>` to pull the diff locally; `/handoff` to a fresh thread when context bloats.
5. **Review & merge**: Agentic Review pass; agent pushes branch / opens PR with the `gh` CLI (commits carry `Amp-Thread:` trailer and co-author unless disabled); thread URL is the audit trail.
6. **Orb pauses** at 5 min idle ($0); wakes on next comment, CI webhook ("Investigate every CI failure on main and post findings to Slack"), or schedule; archive thread to release it.

## Notable techniques worth stealing

- **Setup-then-snapshot per project** (`.agents/setup` → cached image ≤72 h, `.agents/resume` on every wake with a 10 s budget). Simple, committed-to-repo convention; directly portable to any VM layer (exe.dev `--setup-script`, Sprites checkpoints).
- **`.amp/services.yaml` + portals**: declarative dev-server manifest with `$PORT`, health checks, cross-service `${services.x.publicURL}`, authenticated preview URLs with identity headers and a magic-link dev login (`/__dev/log-me-in/$AMP_USER_EMAIL`). Steal the schema for our own preview-URL layer.
- **Workload identity for agents**: `amp orb id-token --audience … --subject-scope thread` — short-lived OIDC per thread instead of static secrets in the sandbox. Pairs well with exe.dev's edge injection / AWS WIF.
- **Idle-pause billing semantics** (5 min → $0, wake on message/webhook/schedule) as the norm for agent VMs.
- **The dial**: a 4-level capability budget with fixed agent/oracle pairings and the rule "lowest mode that can plausibly solve the task in one clean run"; cheap open-weight model for low, frontier for ultra. Map onto Claude Code via `model` + `effort` presets per task class.
- **Oracle pattern**: a *different-vendor* high-reasoning model consulted on demand for plans/reviews; cross-model disagreement as a review signal.
- **Thread-reader subagent** to consume arbitrarily long transcripts instead of compaction alone; `/handoff` = compaction into a new thread with an explicit new objective.
- **`tool.call` policy plugin** with AI classification of destructive commands — an equivalent for Claude Code is a PreToolUse hook calling a small classifier.
- **Agent-to-agent with explicit file exchange** and executor choice (orb/local/runner) — model for our orchestrator: workers don't share a filesystem, results are pulled back deliberately.
- **Event-driven agents via generated webhook plugins** that verify signatures and dedupe — durable URL survives reloads; the orb is off until needed.
- **AGENTS.md conditional includes** (`globs:` frontmatter, `@file` mentions) and reading parent-directory AGENTS.md up to `$HOME` — cheap context scoping.
- **Headless JSONL contract** (`--stream-json`, `--stream-json-input` with `steer: true`) mirrors Claude Code's `-p --output-format stream-json`; a shared adapter (rivet `sandbox-agent`) already covers both.

## Weaknesses / open questions / risks

- **Not a sandbox you can bring your own workload to.** Orbs only run Amp agents on Amp's infra; there is no "give me a VM" API, no custom base image/Dockerfile documented, no SSH, no self-hosting. If the agent isn't Amp, the orb is irrelevant. For a Claude Code–centric stack this is the decisive limitation.
- **Vendor lock-in and churn.** Threads live on Amp's servers; features are deleted at pace ("some will find that refreshing… others infuriating"); pricing and mode names changed three times in 2026. Closed source.
- **No OS-level sandbox and no approval prompts locally.** Running Amp on a laptop is strictly less safe than Claude Code with its Seatbelt/bubblewrap sandbox unless you add a policy plugin or run it in a container.
- **Model opacity.** You cannot pin a model or provider; low mode uses an open-weight model; free mode uses "surplus capacity" with no guarantee. Compliance teams may balk; ad-supported free tier shows sponsored suggestions.
- **Data handling**: Free tier initially required training opt-in (dropped after a week); enterprise "minimal data retention" is custom-only. Thread sharing defaults need care (`amp.defaultVisibility`).
- **Cost**: PAYG at API prices "made Amp more expensive — 'the Apple or Porsche of agentic coding tools'"; $20 Megawatt excludes high/ultra unless you link ChatGPT; enterprise orbs +50%.
- **Orb internals undocumented**: VMM, region, network egress policy, disk persistence beyond 60 GB, snapshot storage, max concurrent orbs per workspace (marketing says "thousands", docs are silent), 72 h snapshot cache means cold setup re-runs for weekly-cadence repos.
- **Librarian only searches default branches; Sourcegraph-scale code intel is no longer bundled** post-spinout (Sourcegraph MCP is optional).
- **Independent benchmarks are mixed**: one 2026 comparison scored Claude Code ahead on 5/6 categories; another found both "went blind on ruff" — orbs/portals are the differentiator, not raw coding quality.
- Open: can runners be pointed at exe.dev/Sprites VMs to get Amp's UX on our own sandbox layer? (Yes in principle: `amp --no-tui --runner-id …` inside any VM.) Does `amp -x` honor `.amp/services.yaml` locally? Is there a REST API for threads/orbs outside the CLI (only `ampcode.com/api/workload-identity` is documented)?

## Fit for our agentic stack

Evaluated strictly as the **sandbox/execution layer for parallel Claude Code agents**: **Amp's orbs are not usable for that** — they run Amp's agent only. So Amp fits our stack as (a) a *reference design* to copy, (b) a possible *secondary agent* for cross-model oracle/review work, and (c) something to keep an eye on for orb APIs opening up.

**Adopt (as patterns, implemented on our own VM layer)**
- The repo-side contract: `AGENTS.md` (Claude Code reads `CLAUDE.md`; keep both or symlink), `.agents/setup` / `.agents/resume`, `.amp/services.yaml`-style service manifest, `.agents/skills/` (Claude Code reads `.claude/skills/`; Amp reads both — standardize on `.agents/skills` with a symlink so either agent works).
- Orb lifecycle semantics: snapshot after setup, idle-pause at 5 min, wake on webhook/schedule, one thread ↔ one VM, explicit file exchange between workers.
- The dial as our task-class → (model, effort, reviewer) table for Claude Code runs; use an Oracle-style second-vendor model for plan review.
- Portals: give every worker VM an authenticated preview URL with identity headers and a magic-link dev login.
- Workload-identity tokens per task instead of static secrets in the sandbox.

**Adapt**
- If we want Amp's UX/threads on our sandboxes: run `amp --no-tui --runner-id <vm>` inside an exe.dev/Sprites VM and create threads from ampcode.com; that gives Amp's web/mobile/multiplayer front end on a VM we control. Worth a spike, but it makes Amp the agent, not Claude Code.
- Use Amp Free/Megawatt purely as a second opinion: `amp -x --stream-json "review this diff for correctness and security"` in CI beside Claude Code's review, to get GPT-5.6/GLM disagreement signal cheaply.

**Skip**
- Orbs as our execution layer (Amp-only), Amp's local mode as a "sandbox" (there is none), and Amp threads as our system of record (hosted, churny). Keep Claude Code as the primary agent; keep the sandbox layer vendor-neutral (exe.dev / Sprites / Docker + Claude Code's built-in sandbox).

## Related resources mentioned

- https://ampcode.com/notes/what-i-want-to-tell-you-about-orbs and https://ampcode.com/notes/orbs-explained — Thorsten Ball's remote-agents thesis; the "harness is becoming less important" argument.
- https://ampcode.com/docs/orbs/portals — the most complete spec for an agent preview-URL layer (`services.yaml`, headers, dev sign-in); worth copying wholesale.
- https://ampcode.com/docs/plugin-api — `tool.call` policy hooks, `createWebhook`, custom agent modes; compare with Claude Code hooks/plugins.
- https://github.com/rivet-dev/sandbox-agent — uniform HTTP control of Claude Code, Codex, Amp, OpenCode inside any sandbox (Apache-2, 1.5k stars).
- https://sidbharath.com/blog/amp-code-guide/ — best third-party operating guide (modes, security hygiene, workflow).
- https://mer.vin/2026/08/agent-harnesses-vs-orbs-why-remote-sandboxes-beat-local-agent-loops/ — summarizes orb numbers (Debian 12, 5-min pause, $0.08–$1.32/hr).
- https://www.alexdunlop.com/writing/amp-vs-claude-code-worth-switching-2026 — pricing/model-routing comparison with Claude Code.
- https://sourcegraph.com/blog/why-sourcegraph-and-amp-are-becoming-independent-companies — spinout rationale.
- https://github.com/ampcode/amp.nvim — Neovim integration.
- agentskills.io `SKILL.md` standard — shared by Amp, Claude Code, exe.dev's Shelley.

## Key quotes / references

- "An orb is a remote machine that Amp creates for a thread. It has your code, your tools, and a full development environment, and the agent works there instead of on your computer." — docs, *Orbs: Getting Started*
- "Amp automatically pauses an orb after five minutes without activity and pauses it when its thread is archived." — docs, *Sizes & Costs*
- "`.agents/setup` installs dependencies and tools. Amp runs it once when it prepares a new orb and saves the result as a snapshot." — docs, *Orbs*
- "By default, Amp does not ask for approval before running tools." — docs, *Tools*
- "The thing we called harness for the last year is becoming less and less important. Higher-level abstractions, such as orbs and portals… is what we need to focus on next." — Thorsten Ball, via mer.vin summary of *What I Want to Tell You About Orbs*
- "Amp is Sourcegraph's bet on the frontier: it deletes old workflows and stale assumptions so you stay close to what works now." — ampcode.com
- "Compared to other agents on monthly subscriptions, this made Amp more expensive—'the Apple or Porsche of agentic coding tools', to put it nicely." — news, *Subscriptions, At Last* (2026-07-18)
- "If it can send an HTTP request, it can wake an orb." — news, *Event Driven Orbs* (2026-07-23)
- "Stay on Claude Code if you want a predictable bill and you're happy in the Anthropic ecosystem." — alexdunlop.com comparison

**Gaps:** `ampcode.com/manual` now redirects to `/docs`; `/docs/threads`, `/docs/agent`, `/docs/collaboration/threads`, `/news/subagents` returned 404 (thread/subagent details taken from `/docs/tools`, `/docs/cli/*`, third-party guides, and the news index). Orb VMM/region/egress and concurrency limits are not documented. HN discussion of Amp specifically was not surveyed in depth.
