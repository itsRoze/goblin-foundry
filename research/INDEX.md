# Research index

Index of every markdown file under `research/` (excluding this file and `research/_synthesis/`). Research was conducted **2026-08-26**, in two rounds: an initial sweep across all sections below, plus a second pass that filled gaps and appended the follow-up queue. Each entry is one file's title, its resource URL (if the file has a `**URL:**` line), and a one-line hook pulled from the file's own "One-paragraph summary" section.

Files follow a shared template (`_meta/TEMPLATE.md`): `One-paragraph summary → Core ideas/thesis → Architecture & mechanics → Workflow: end to end → Notable techniques worth stealing → Weaknesses/open questions/risks → Fit for our agentic stack`. Not every file uses every section verbatim (a few comparison/landscape docs use tables instead).

`_meta/FOLLOWUP-QUEUE.md` tracks resources spotted mid-research that may deserve their own file later — it currently holds **222** queued rows. Sections below appear in this order: runtime, sandboxes, factories, patterns, skills-agents, validation, git-snapshots, blogs, _meta.

## synthesis and direction

- [SYNTHESIS.html](SYNTHESIS.html) — Visual synthesis of the full research corpus: theses, layers, adopt list, decisions, failure modes, metrics, and open questions.
- [CRITIQUE-AND-PROPOSED-DIRECTION.md](CRITIQUE-AND-PROPOSED-DIRECTION.md) — Critical review and proposed v1 direction after selecting an owned ticket system and an offline Android RSS reader as the first proving product.

## runtime

- [pi.md](runtime/pi.md) — pi (earendil-works/pi) — minimal, extensible coding-agent harness. https://github.com/earendil-works/pi — docs: https://pi.dev/docs/latest
  Minimal 4-tool terminal coding agent built on `pi-ai`/`pi-agent-core`/`pi-tui`; everything else is a hot-reloadable extension.
- [pi-design-philosophy-posts.md](runtime/pi-design-philosophy-posts.md) — pi design philosophy — Mario Zechner & Armin Ronacher posts.
  Control context and get out of the way; add capability via self-written extensions, not MCP or sub-agent frameworks.
- [pi-extensions-catalog.md](runtime/pi-extensions-catalog.md) — pi ecosystem catalog — parallelism, orchestration, sandboxing, observability extensions. https://pi.dev/packages
  Because pi core ships nothing, an ecosystem of overlapping fan-out, sandboxing, and coordination packages exploded.
- [pi-remote-and-sandboxing.md](runtime/pi-remote-and-sandboxing.md) — pi remote sessions & sandboxing — Docker, Gondolin, OpenShell, pi-server/client/protocol.
  pi has no built-in permission system, so isolation means Docker, Gondolin microVMs, or an OpenShell policy gateway.
- [disler-pi-factories.md](runtime/disler-pi-factories.md) — IndyDevDan (disler) pi-native factories & agentic-coding material.
  "Agent proposes, code disposes": a deterministic Python control plane drives headless pi through bounded, gated phases.

## sandboxes

- [amp.md](sandboxes/amp.md) — Amp (ampcode.com). https://ampcode.com/
  Hides model choice behind a dial and moved its center of gravity to "orbs" — per-thread Debian VMs with portals.
- [cloudflare-sandbox.md](sandboxes/cloudflare-sandbox.md) — Cloudflare Sandbox SDK + Cloudflare Containers. https://developers.cloudflare.com/sandbox/
  Serverless per-Durable-Object VMs with an egress proxy that injects secrets so the sandbox never holds real keys.
- [daytona.md](sandboxes/daytona.md) — Daytona. https://www.daytona.io
  Managed container/VM sandboxes with a placeholder-secrets proxy and an official pi extension syncing sessions to branches.
- [e2b.md](sandboxes/e2b.md) — E2B (e2b.dev). https://e2b.dev
  Firecracker microVMs with the richest state model — pause/resume, snapshots, in-place fork up to 100 clones.
- [exe-dev-factory-series.md](sandboxes/exe-dev-factory-series.md) — exe.dev "software factory" blog series + open-source pieces. https://blog.exe.dev/
  "7 people, 9 workflows": pre-merge merge queues, "review the reviews," and ~10 single-purpose 11-line bots.
- [exe-dev.md](sandboxes/exe-dev.md) — exe.dev. https://exe.dev/
  Persistent Linux KVM VMs on a pooled-CPU plan, priced so "spin up ten sandboxes" is a non-decision.
- [modal.md](sandboxes/modal.md) — Modal Sandboxes. https://modal.com/docs/guide/sandbox
  gVisor containers with delta/directory snapshots; slowest cold start of the major providers, no in-place pause/resume.
- [provider-comparison.md](sandboxes/provider-comparison.md) — Cloud sandbox providers — decision matrix for the goblin-foundry factory.
  Compares plan floors, 1:N forking, out-of-VM secrets, and pi support across every major sandbox provider.
- [small-oss-sandboxes.md](sandboxes/small-oss-sandboxes.md) — Smaller / OSS sandbox options for the pi factory. https://boxd.sh
  boxd: real KVM VMs that live-fork memory+disk+processes in 100-200ms and hibernate to disk in ~85ms.
- [sprites.md](sandboxes/sprites.md) — Fly.io Sprites. https://sprites.dev
  Firecracker microVMs billed only for CPU/memory/bytes actually used, with copy-on-write disk checkpoints under a second.
- [vercel-sandbox.md](sandboxes/vercel-sandbox.md) — Vercel Sandbox. https://vercel.com/docs/sandbox
  Per-sandbox Firecracker microVMs, persistent by default via auto-snapshot/auto-resume; ships pi preinstalled.

## factories

- [sandcastle.md](factories/sandcastle.md) — Sandcastle. https://github.com/mattpocock/sandcastle
  A single TypeScript function call turns "run a coding agent unattended" into sandbox + worktree + resumable session.
- [super-simple-software-factory.md](factories/super-simple-software-factory.md) — Super Simple Software Factory (SSSF). https://github.com/disler/super-simple-software-factory
  A stamped Claude Code skill installs a deterministic Python factory where "agent proposes, code disposes."
- [swarm-forge.md](factories/swarm-forge.md) — SwarmForge (swarm-forge). https://github.com/unclebob/swarm-forge
  A tmux pack of agent roles hands off work via validated five-line messages under a craftsmanship "constitution."

## patterns

- [afk-workflow.md](patterns/afk-workflow.md) — jspicher/afk-workflow. https://github.com/jspicher/afk-workflow
  Splits work into a human day shift (PRD, triage) and an autonomous Ralph-loop night shift with strict TDD.
- [beads.md](patterns/beads.md) — Beads (`bd`) — dependency-aware issue graph for coding agents. https://github.com/gastownhall/beads
  Replaces the Ralph plan file with a Dolt-backed, git-synced issue graph agents query/claim via `bd ready --claim`.
- [ralph-loop.md](patterns/ralph-loop.md) — Ralph loop (Ralph Wiggum technique). https://ghuntley.com/ralph/
  `while :; do cat PROMPT.md | claude; done` — intelligence lives in the spec, plan file, and backpressure, not the loop.
- [rpi-qrspi-humanlayer-skills.md](patterns/rpi-qrspi-humanlayer-skills.md) — RPI → QRSPI and humanlayer/skills. https://alexlavaee.me/blog/from-rpi-to-qrspi/
  Research-Plan-Implement broke at scale; QRSPI spreads alignment across more, smaller phases with fresh-context discipline.
- [spec-driven-methods.md](patterns/spec-driven-methods.md) — Spec-driven agent methodologies: GSD, BMAD-METHOD, GitHub Spec-Kit (compared).
  All three force a reviewed markdown chain before implementation; they differ in role-heaviness and autonomy.

## skills-agents

- [agent-skills-spec.md](skills-agents/agent-skills-spec.md) — Agent Skills specification (agentskills.io). https://agentskills.io/specification
  A skill is a folder with `SKILL.md`; progressive disclosure keeps startup cheap while staying portable across harnesses.
- [claude-code-plugins.md](skills-agents/claude-code-plugins.md) — Claude Code plugins + official marketplace. https://code.claude.com/docs/en/plugins-reference
  Plugins bundle skills/agents/hooks/MCP; only the `skills/` piece is portable to pi without translation.
- [fusion-harness.md](skills-agents/fusion-harness.md) — fusion-harness (disler / IndyDevDan). https://github.com/disler/fusion-harness
  Runs 2-5 frontier models on one task with a single-writer invariant, debate, fusion, and gate-first validation modes.
- [hooks-mastery-to-pi-mapping.md](skills-agents/hooks-mastery-to-pi-mapping.md) — disler/claude-code-hooks-mastery → pi extension event mapping. https://github.com/disler/claude-code-hooks-mastery
  Maps every Claude Code hook event (blocking dangerous bash, validating prompts, TTS on stop) onto pi's `pi.on(...)`.
- [humanlayer-skills.md](skills-agents/humanlayer-skills.md) — humanlayer/skills. https://github.com/humanlayer/skills
  Five packaged skills; two scaffold a control-theory-framed scheduled agentic loop with memory and `/iterate`.
- [mattpocock-skills.md](skills-agents/mattpocock-skills.md) — mattpocock/skills ("Skills For Real Engineers"). https://github.com/mattpocock/skills
  ~37 short SKILL.md docs encoding classic engineering discipline (TDD, DDD, tracer bullets) as repeatable agent process.
- [skills-sh-registry.md](skills-agents/skills-sh-registry.md) — skills.sh + vercel-labs/skills (`npx skills`). https://skills.sh
  An npm-free, agent-agnostic installer/registry for Agent-Skills folders, symlinked from one canonical copy.
- [wayfinder.md](skills-agents/wayfinder.md) — /wayfinder (Matt Pocock). https://www.latent.space/p/wayfinder-skill
  Multi-session planning for foggy work via a tracker issue graph of typed decision tickets and a visible frontier.

## validation

- [slopcodebench.md](validation/slopcodebench.md) — SlopCodeBench (SCBench) — checkpointed, held-out, black-box evals. https://www.scbench.ai
  A long-horizon benchmark where agents extend their own code across cold checkpoints while quality metrics are tracked.
- [uber-autocover-ureview-mechanics.md](validation/uber-autocover-ureview-mechanics.md) — Uber AutoCover + uReview mechanics. https://www.uber.com/us/en/blog/ureview/
  Stack cheap deterministic oracles first (compile, coverage, mutation) and use a model only to rank/filter survivors.
- [unclebob-acceptance-and-quality-tools.md](validation/unclebob-acceptance-and-quality-tools.md) — Uncle Bob's machine-checked quality gate. https://github.com/unclebob/Acceptance-Pipeline-Specification
  He doesn't read agent code; he surrounds agents with Gherkin acceptance tests, mutation testing, CRAP/DRY metrics.
- [validation-landscape.md](validation/validation-landscape.md) — Validation landscape — oracle types, tools, thresholds.
  "Definition of done" is a stack of oracles ordered by cost; only deterministic checks should ever block a merge.

## git-snapshots

- [acp.md](git-snapshots/acp.md) — Agent Client Protocol (ACP). https://agentclientprotocol.com
  "LSP for agents": JSON-RPC between an editor client and an agent subprocess, streaming tool calls and diffs.
- [cursor-origin.md](git-snapshots/cursor-origin.md) — Cursor Origin. https://cursor.com/origin
  Cursor's own git forge, mirror-first from GitHub, with agent-native provenance and merge-queue features not yet shipped.
- [deltadb-data-model.md](git-snapshots/deltadb-data-model.md) — Zed DeltaDB — data model only. https://zed.dev/blog/introducing-deltadb
  Every edit is a fine-grained, stably-identified CRDT delta living between git commits; mechanism mostly unpublished.
- [jujutsu.md](git-snapshots/jujutsu.md) — Jujutsu (jj) for agent workspaces. https://github.com/jj-vcs/jj
  A git-compatible VCS whose working copy is a commit, with an undoable operation log and first-class conflicts.
- [landscape.md](git-snapshots/landscape.md) — Landscape: versioning/checkpointing/provenance for parallel agent work.
  Comparison table of worktrees, Claude Code checkpoints, jj, DeltaDB, Cursor Origin, and stacking tools for isolation.
- [stacking-and-merge-queues.md](git-snapshots/stacking-and-merge-queues.md) — Stacking tools, merge queues, and off-GitHub CI runners.
  Stacked small PRs, a merge queue gate against future main, and batched CI capacity for dozens of daily agent PRs.
- [worktree-orchestrators.md](git-snapshots/worktree-orchestrators.md) — Worktree orchestrators for parallel coding agents. https://github.com/andyrewlee/awesome-agent-orchestrators
  All create a worktree+branch per task and run an agent CLI in it; none targets one-VM-per-agent.
- [zed-delta.md](git-snapshots/zed-delta.md) — Zed Delta (+ DeltaDB). https://zed.dev/blog/introducing-delta
  A multiplayer desktop app over DeltaDB where agent/human messages sit side-by-side with the edits they produced.

## blogs

- [cognition-frontier-code.md](blogs/cognition-frontier-code.md) — Cognition FrontierCode eval + Devin Fusion. https://cognition.com/blog/frontier-code
  Benchmarks mergeability, not test-pass, via maintainer rubrics and reverse-classical tests; Fusion splits main/sidekick agents.
- [company-factories-ramp-stripe-workos-brex.md](blogs/company-factories-ramp-stripe-workos-brex.md) — Company agentic-dev write-ups: Ramp, Stripe, WorkOS, Brex.
  Same skeleton — pre-warmed sandbox, MCP tool server, human PR review gate — different bets on context, process, or events.
- [dan-shapiro-five-levels.md](blogs/dan-shapiro-five-levels.md) — Dan Shapiro — "The five levels from spicy autocomplete to the software factory." https://www.danshapiro.com/blog/2026/01/the-five-levels-from-spicy-autocomplete-to-the-software-factory/
  A driving-automation-style taxonomy from manual coding to the Dark Factory where humans are "neither needed nor welcome."
- [dexhorthy-2080697380379427275.md](blogs/dexhorthy-2080697380379427275.md) — Why Software Factories Fail (Part 1). https://x.com/dexhorthy/status/2080697380379427275
  No harness engineering fixes maintainability degradation, because coding RL rewards fast test-pass, not slow-cost design.
- [dexhorthy-2081797628552270027.md](blogs/dexhorthy-2081797628552270027.md) — Why Software Factories Fail (Part 3 — Opus 5 on SlopCodeBench). https://x.com/dexhorthy/status/2081797628552270027
  Introduces SlopCodeBench as measurable backing for Part 1's vibes; no model finished any challenge defect-free.
- [dexhorthy-article-2081058573556306030.md](blogs/dexhorthy-article-2081058573556306030.md) — Why Software Factories Fail (Part 2 — Turning the lights back on). https://x.com/dexhorthy/article/2081058573556306030
  Since models can't judge quality, put code review back and front-load alignment through program design and vertical slices.
- [dexhorthy-context.md](blogs/dexhorthy-context.md) — Dex Horthy / HumanLayer — background for software-factory research.
  Background on 12-Factor Agents, ACE-FCA, RPI/QRSPI, Ralph loops, and harness engineering that recur across this research.
- [faros-whiplash-report.md](blogs/faros-whiplash-report.md) — Faros AI — "AI Engineering Report 2026: The Acceleration Whiplash." https://www.faros.ai/research/ai-acceleration-whiplash
  Telemetry shows AI raised throughput but bugs, incidents, review time, and churn rose even faster.
- [openai-harness-engineering.md](blogs/openai-harness-engineering.md) — OpenAI "Harness Engineering" + Symphony. https://openai.com/index/harness-engineering/
  A small OpenAI team shipped 1M+ LOC with 0% human-written code by engineering the environment, not the agent.
- [strongdm-lights-off.md](blogs/strongdm-lights-off.md) — StrongDM "Software Factory" (lights-off) + Weather Report. https://factory.strongdm.ai/
  Replaces code review with scenario-based validation against cloned third-party services at ~$1,000/engineer/day in tokens.
- [uber-software-factory.md](blogs/uber-software-factory.md) — How Uber built a software factory for agentic coding. https://newsletter.port.io/p/how-uber-built-a-software-factory
  A six-layer internal platform makes agents cheap and context-rich; validation shifts left before a draft PR ever opens.

## _meta

- [FOLLOWUP-QUEUE.md](_meta/FOLLOWUP-QUEUE.md) — Follow-up research queue.
  222 resources spotted during research that may deserve their own file, with source and rationale per row.
- [TEMPLATE.md](_meta/TEMPLATE.md) — `<Resource name>` template.
  The seven-heading skeleton (summary, core ideas, architecture, workflow, techniques, weaknesses, fit) every file follows.
