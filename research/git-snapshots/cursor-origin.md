# Cursor Origin

- **URL:** https://cursor.com/origin (landing), https://cursor.com/docs/origin (docs), https://cursor.com/codebase (app entry / GitHub sync)
- **Type:** blog/product — git forge (hosting + PRs + review), positioned as "agent-native infrastructure"
- **Author/Org:** Cursor (Anysphere Inc.; acquired by SpaceX for ~$60B all-stock three days before launch, now inside "SpaceXAI"). Origin is led by Tomas Reimers, co-founder of Graphite (acquired by Cursor Dec 2025).
- **Researched:** 2026-08-26
- **Status/maturity:** Announced 2026-06-17 at Cursor's Compile conference (waitlist); early beta shipped 2026-08-17 to all paid plans (Pro, Teams, Enterprise; enterprise admins can opt out; not on Free; teams on legacy privacy mode cannot enable). Closed source, hosted only. No separate price: bundled into plan seats (Teams ~$40/user/mo). No public API docs found beyond "connect automations and cloud agents". HN: items 49334209, 49339359, 49336919 (the last one is about a GitHub degradation knocking out Origin's mirror sync on launch day).

## One-paragraph summary

Origin is Cursor's own git hosting service — "a git forge for the agentic era" — surfaced as a "Codebase" tab inside the Cursor editor and at cursor.com/codebase. It is plain git underneath: clone/push/pull over HTTPS with standard clients or the Origin CLI, repositories, pull requests with timeline/commits/checks/diffs, code browsing with semantic search, and a chat layer that can answer questions about a repo, edit, and update PRs. The beta is *mirror-first*: you connect a GitHub org, Origin copies history/branches/tags/PRs, keeps them synced, mirrors GitHub permissions, and syncs PR comments bidirectionally "within seconds" — GitHub stays the system of record until you detach. Launch partners are Vercel (preview deploys per PR), Depot and Buildkite (CI that runs existing GitHub Actions workflows unchanged). The agent-native features that justify the name — provenance for agent-authored commits (who ran the agent, which model, which session, which instructions), non-human principals with scoped/revocable/auditable write access, machine-readable review states, stacked PRs with a dependency graph, and an agent-aware merge queue that moves PRs "towards a mergeable state" — were announced in June but are explicitly *not in the beta* ("ship soon").

## Core ideas / thesis

- "Code is moving faster than any infrastructure was built to handle." Cursor claims 35% of PRs merged inside Cursor are opened by autonomous cloud agents; review, not authoring, is the bottleneck.
- The primary user of source control is about to be the agent, so the forge should (a) understand agent identity/provenance at the hosting layer, (b) permission agents as first-class principals, (c) offer review workflows for bulk/programmatic approval, and (d) automatically drive PRs to mergeable (rebase, fix CI, resolve conflicts) instead of waiting for humans.
- Stacked PRs (Graphite's lineage) as the natural shape of dependent agent output; merge queues as the throttle that keeps `main` green when dozens of agents push.
- "The boundary between where you write code and where you collaborate on it feels increasingly arbitrary" — collapse editor, agents, and forge into one product.
- Do *not* replace git as the primitive: "Origin does not bet against Git as a version-control primitive. It is Git-compatible."

## Architecture & mechanics

- **Storage / protocol:** ordinary git repositories, served over HTTPS at `https://cursor.com/codebase/{owner}/{repo}`; an `origin` CLI (name collides with the git remote convention — HN flagged the risk of an LLM misreading "push to origin") for cloning existing repos and pushing local projects. No custom object model, no CRDT, no operation log; history is commits.
- **GitHub sync (beta's main mode):** connect a GitHub org -> Origin imports history, branches, tags, PRs and keeps them updated; pushes continue to go to GitHub, "which stays the source of truth for anything started there"; permissions mirror GitHub's; PR comments sync both ways. Repos can also be created natively in Origin (including by Cursor agents). "Detach" ends the mirror and makes Origin canonical.
- **Forge surface:** repos, PRs (timeline, commits, checks, file diffs), code browsing, semantic search, and a "chat-assist layer" — ask questions about a file, hand a review comment to an agent to revise, ask it to push a branch, all from inside the editor.
- **Integrations:** Vercel (preview per PR, prod on merge), Depot and Buildkite (CI; both execute existing GitHub Actions YAML unchanged; Buildkite also native pipelines). "Connect automations and cloud agents to Origin repos" — Cursor's Automations and Cloud Agents can target Origin repos directly instead of going through GitHub. An API + MCP extensibility story was announced in June.
- **Announced, not shipped (per changelog "ship soon"):** provenance metadata on agent commits (runner, model, session, instructions); agent principals with scoped, revocable, auditable write access; machine-readable review states for bulk agent approval; stacked PRs with visible dependency graph; agent-aware merge queue; review surfaces "built for machine-authored code"; broader CI integration.
- **Not available:** public repos, self-hosting, open source, CI of its own, data-retention/training-use policy (called out by InfoQ/VentureBeat), namespace rename during beta.

Concrete file paths / commands: docs describe "Clone, push, and pull with standard git" and an Origin CLI, but no command reference was retrievable (docs page is thin).

## Workflow: end to end

1. Go to cursor.com/codebase, claim a namespace, connect your GitHub org (or create/push a repo natively via the CLI).
2. Origin mirrors repo + PRs; permissions follow GitHub.
3. In Cursor (Codebase tab) or a Cloud Agent/Automation, spin up agents on a task; they push branches to Origin (mirrored to GitHub if the repo started there).
4. Agents open PRs; PRs show timeline/commits/checks; Vercel builds a preview; Depot/Buildkite run the existing GitHub Actions workflows.
5. Reviewers comment in Origin *or* GitHub — comments sync both ways. A reviewer can hand a comment straight to an agent to address.
6. Merge from Origin (or GitHub). Future: PRs enter an agent-aware merge queue that rebases/repairs them until mergeable; dependent PRs are stacked.
7. Optionally detach from GitHub so Origin becomes the system of record.

## Notable techniques worth stealing

- **Provenance at the hosting layer, as structured metadata**: (who ran the agent, model, session id, instruction/prompt hash) attached to commits/PRs. We can implement today with commit trailers + a `.factory/` journal + PR-body front-matter, and enforce with a pre-receive/CI check that every agent commit carries them.
- **Agents as first-class principals** with scoped, revocable, auditable credentials — i.e. one GitHub App installation / deploy token per agent role, never a human PAT. Makes attribution and revocation trivial.
- **Machine-readable review state** ("mergeable", "needs-human", "blocked-by") — a PR label/check schema that agents and the merge queue can read without parsing comments.
- **"Move PRs toward mergeable" loop**: a queue worker that rebases, re-runs CI, and dispatches a fix-up agent on failure, instead of leaving stale agent PRs to rot.
- **Stacked PRs for dependent agent output** (Graphite-style) — keeps each agent's diff small and reviewable when one task depends on another.
- **Mirror-first migration** — a good pattern for any factory-owned forge/side-store: keep GitHub canonical, sync in, detach only when confident.
- **Run existing GitHub Actions unchanged on other CI** (Depot/Buildkite) — a migration lever worth knowing exists.

## Weaknesses / open questions / risks

- **The agent-native parts are vaporware today.** Beta = mirror + PR UI + chat; provenance, principals, stacked PRs, merge queue are promises.
- **Lock-in and custody**: closed, hosted only, bound to Cursor accounts; no published retention, residency, training-use or subprocessor terms at launch; ownership is now SpaceX/xAI (analysts explicitly worried about differing guardrail norms). Enterprise default is *on* (opt-out).
- **Reliability coupling**: launch-day GitHub outage broke Origin's sync (HN 49336919) — mirror mode inherits GitHub's availability while adding a second failure surface.
- **No public API/CLI docs** — hard to script from a non-Cursor harness; "connect automations and cloud agents" means *Cursor's* agents.
- **Naming**: `origin` CLI vs `origin` git remote; real risk of agent confusion.
- **Narrow feature set vs GitHub/GitLab** (no public projects, no CI, thin marketplace); HN pointed to Forgejo/Gitea/GitLab/Radicle/Tangled as more open alternatives.
- Nothing here addresses *sub-commit* snapshots or rollback; Cursor's separate, local Checkpoints feature does that inside the editor only.

## Fit for our agentic stack

Assumption: Claude Code-centric, many parallel agents in worktrees, need checkpoints/rollback/attribution.

- **As the git/snapshot layer: no.** Origin is a forge, not a snapshot system. It adds nothing below the commit; it does not know about worktrees or in-flight agent edits. Snapshots/rollback stay with git + Claude Code checkpoints + our own journal.
- **As the provenance/merge layer: not now, maybe later.** The *announced* feature list (agent principals, provenance metadata, machine-readable review states, agent-aware merge queue, stacked PRs) is exactly the spec for the factory's integration layer — but none of it ships, it is Cursor-agent-centric, and it is closed/hosted with unclear data terms. A Claude Code fleet would be a second-class citizen.
- **Adopt the spec, on GitHub:** implement provenance trailers (`Agent-Session`, `Agent-Model`, `Agent-Prompt-Sha`, `Agent-Runner`), per-role GitHub App identities, a check/label schema for machine-readable review state, GitHub merge queue (or Mergify/Trunk) with an auto-repair agent, and Graphite/`gt` or `git-spice`/`jj` for stacks. This gets ~all of Origin's promised value with no lock-in.
- **Watch for:** public API + MCP server for Origin; provenance schema publication (worth aligning our trailer names to it if it becomes a de-facto standard); self-host/enterprise data terms.

## Related resources mentioned

- Graphite (stacked PRs, merge queue; acquired by Cursor Dec 2025) https://graphite.dev — the actual shipped implementation of the stacking/queue ideas; still usable on GitHub.
- Cursor Cloud Agents / Automations https://cursor.com/docs — the agent fleet Origin is built to serve.
- Cursor Checkpoints https://cursor.com/docs/agent/chat/checkpoints — local, non-git snapshots of agent edits (see landscape.md).
- Depot https://depot.dev and Buildkite https://buildkite.com — CI that runs GitHub Actions workflows off-GitHub.
- Vercel preview deploys per PR.
- InfoQ writeup https://www.infoq.com/news/2026/08/cursor-origin-alternative-github/ ; VentureBeat https://venturebeat.com/infrastructure/cursor-launches-origin-code-hosting-platform-as-github-outage-exposes-opening-in-ai-coding-race
- Alternatives raised on HN: Forgejo (federation), Gitea, GitLab, Radicle (p2p), Tangled (ATProto).
- HN threads: https://news.ycombinator.com/item?id=49334209 , https://news.ycombinator.com/item?id=49339359 , https://news.ycombinator.com/item?id=49336919

## Key quotes / references

- "Origin is Cursor's git forge for storing and sharing code." (docs)
- "Code is moving faster than any infrastructure was built to handle. Origin was designed for this moment." (landing page)
- "Pushes keep going to GitHub, which stays the source of truth for anything started there." (Cursor changelog, via press)
- "Origin does not bet against Git as a version-control primitive. It is Git-compatible, meaning standard clients, existing CI pipelines, and push/pull workflows keep working." (June announcement coverage)
- Announced features: "provenance for commits an agent wrote — recording who ran the agent, with which model, from which session, under which instructions — at the hosting layer, and permissioning for non-human actors as first-class principals with scoped, revocable, auditable write access." (press summary of June announcement)
- "We were going to ship this earlier, but GitHub was down." (Matt Palmer, Cursor, on launch day)
- "35% of pull requests merged inside Cursor were opened by agents running autonomously in cloud virtual machines." (VentureBeat, citing Cursor)

### Gaps
- cursor.com/blog/origin returned 404 (no dedicated blog post found; announcement lives in changelog + June keynote). HN threads 49334209/49339359 returned 429 from HN directly; 49334209 read via zeli.app mirror, 49339359 not read. No API/CLI reference retrievable. Exact per-plan pricing beyond "bundled" not confirmed from a primary source.
