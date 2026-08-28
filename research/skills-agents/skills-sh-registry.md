# skills.sh + vercel-labs/skills (`npx skills`)

- **URL:** https://skills.sh ; https://github.com/vercel-labs/skills
- **Type:** skills/agents (installer CLI + registry/leaderboard)
- **Author/Org:** Vercel Labs
- **Researched:** 2026-08-26
- **Status/maturity:** 29.7k stars, 2.5k forks, MIT, ~800 open issues, pushed 2026-08-18. De-facto universal installer; 75+ agent targets. skills.sh tracks install telemetry (8-week activity) and ranks.

## One-paragraph summary

`npx skills` is an npm-free, agent-agnostic package manager for Agent-Skills folders. It resolves a source (GitHub `owner/repo`, any git URL, GitLab, local path, direct `SKILL.md`/archive URL), discovers `SKILL.md` directories (walks `skills/`, `.agents/skills/`, `.claude/skills/`, `.pi/skills/` and ~60 other vendor dirs up to three levels deep, plus Claude plugin manifests), and installs each selected skill into every chosen agent's skill directory, by default as **symlinks to one canonical copy**. skills.sh is the companion registry: a static directory of GitHub-hosted skills with install counts, categories, and per-agent views; there is no upload step, anything on GitHub with a `SKILL.md` is installable.

## Core ideas / thesis

- One command for every harness: `npx skills add owner/repo --skill x -a claude-code pi codex`.
- Symlink model: single source of truth per project/user, `npx skills update` refreshes all.
- Registry is derived, not curated: install counts come from CLI telemetry (public repos only), so popularity is an actual usage signal.

## Architecture & mechanics

### Commands
```
npx skills add <source> [--skill <name|'*'>] [-a <agents...>|'*'] [-g] [-y] [--copy] [--all] [-l] [--full-depth]
npx skills use <source> --skill <name> [--agent <one>]    # print prompt / launch agent without installing
npx skills find [query] [--owner vercel]                  # search skills.sh
npx skills list | ls
npx skills update
npx skills remove <name> [-a <agents>|'*'] [--all]
npx skills init [name]                                    # scaffold SKILL.md
```
Flags: `-g` global (`~/<agent>/skills/`) vs project (`./<agent>/skills/`); `-a` agent list; `-s/--skill`; `-y`; `--copy` instead of symlink.

### Agent paths (subset relevant to us)

| Agent | `--agent` | Project | Global |
|---|---|---|---|
| Claude Code | `claude-code` | `.claude/skills/` | `~/.claude/skills/` |
| **Pi** | `pi` | `.pi/skills/` | `~/.pi/agent/skills/` |
| Codex | `codex` | `.agents/skills/` | `~/.codex/skills/` |
| Cursor | `cursor` | `.agents/skills/` | `~/.cursor/skills/` |
| Amp / Replit / Universal | `amp`, `universal` | `.agents/skills/` | `~/.config/agents/skills/` |
| Cline, Zed, Warp, Kimi… | | `.agents/skills/` | `~/.agents/skills/` |
| Copilot | `github-copilot` | `.agents/skills/` | `~/.copilot/skills/` |
| Gemini CLI | `gemini-cli` | `.agents/skills/` | `~/.gemini/skills/` |
| OpenCode | `opencode` | `.agents/skills/` | `~/.config/opencode/skills/` |

Note: the CLI targets pi at `.pi/skills/` even though pi also reads `.agents/skills/` (and `~/.agents/skills/`), so installing for `universal` already covers pi.

### Source resolution
GitHub shorthand → GitHub tree API (anonymous → `GITHUB_TOKEN`/`GH_TOKEN` → `gh api`); full git URLs (GitHub/GitLab/generic, SSH for private); local dirs; direct download of a single `SKILL.md` or `.zip/.tar.gz` (10 MiB / 25 MiB / 1000 files caps). Discovery: root `SKILL.md`, `skills/`, `skills/.curated|.experimental|.system/`, every vendor dir, walked 3 levels (flat or 1-2 category levels; shallower shadows deeper). `.claude-plugin/marketplace.json` / `plugin.json` `skills` arrays are also honored (`metadata.pluginRoot`). Fallback: recursive search.

### Skill metadata the CLI reads
`name`, `description` required. `metadata.internal: true` hides a skill unless `INSTALL_INTERNAL_SKILLS=1`.

### Compatibility matrix (README)
Basic skills: all. `allowed-tools`: yes for Pi, Claude Code, Codex, Cursor, Copilot, OpenCode…; no for Kiro CLI, Zencoder. `context: fork`: Claude Code only. Hooks in skills: Claude Code, Cline, Kiro CLI only.

### Registry (skills.sh)
Top 10 by 8-week installs (2026-08-26): `find-skills` (vercel-labs/skills, 3.1M), `grill-me` (978k), `grill-with-docs` (833k), `frontend-design` (anthropics/skills, 823k), `improve-codebase-architecture` (802k), `tdd` (775k), `agent-browser` (vercel-labs/agent-browser, 736k), `setup-matt-pocock-skills` (714k), `handoff` (679k), `triage` (673k). Seven of ten are mattpocock/skills. Categories: React, Next.js, Design & UI, Mobile, Agent workflows, Databases, Testing, Marketing; per-agent pages; All-time / Trending / Hot views. Badge: `https://skills.sh/b/owner/repo`.

## Workflow: end to end

1. `npx skills init my-skill` → edit `SKILL.md`.
2. Push to GitHub in `skills/<name>/` (or `.agents/skills/<name>/`).
3. Consumers: `npx skills add you/repo --skill my-skill -a universal claude-code -y` → canonical copy + symlinks in `.agents/skills/` and `.claude/skills/`; pi picks up `.agents/skills/` after project trust.
4. `npx skills update` to pull; `npx skills find my-skill` once telemetry indexes it.

## Notable techniques worth stealing

- **Symlink-to-canonical layout** solves the "installed twice via plugin and via skills" duplication trap noted in mattpocock-skills.md. Adopt: canonical `.agents/skills/`, symlink `.claude/skills/<name>` → `../../.agents/skills/<name>`.
- **`metadata.internal`** for WIP/in-progress skills in the same repo.
- **Bounded catalog walk (3 levels)** means `skills/<bucket>/<name>/` layouts (Pocock) work; keep ours ≤ 2 levels.
- **`skills use --agent pi`**: run a skill once without installing, handy for factory one-shots.
- **Marketplace-manifest discovery**: a single repo can be both a Claude marketplace and a `npx skills` source with no duplication.

## Weaknesses / open questions / risks

- Telemetry-driven popularity rewards early movers; `find-skills` being #1 is an artifact of Vercel's own bootstrap skill.
- Supply chain: installs arbitrary Markdown + scripts from any public repo with no signing; no lockfile pinning to SHA was found in the README (needs source check).
- 800 open issues; vendor-dir list is large and churns.
- Pi target path is `.pi/skills/` (project) which requires trust and is pi-only; prefer `universal`.

## Fit for our agentic stack

- Distribute goblin-foundry skills as a GitHub repo consumable by `npx skills add goblin-foundry/skills` and mirror install text in README (as Pocock's `.agents/install-block.md`).
- In sandboxes, pre-bake skills into the image rather than running `npx skills` at boot (network + trust prompts); or `pi install git:github.com/goblin-foundry/skills` which handles `skills/` dirs natively.
- Use skills.sh only as discovery for third-party skills to vendor (pin by copying, review, commit), never live-installed into workers.

## Related resources mentioned

- https://github.com/vercel-labs/agent-browser — #7 skill, browser automation CLI-as-skill.
- https://github.com/vercel-labs/agent-skills — Vercel's own set (`web-design-guidelines`, `frontend-design`...).
- skillselion.com — independent index with security/clone censuses (`State of AI Agent Skills 2026`, `Skill Security Census`).
- Well-known discovery (`/.well-known/skills`?) hinted by "tried after well-known discovery" in README; spec unclear.

## Key quotes / references

- "Symlink (Recommended): Creates symlinks from each agent to a canonical copy. Single source of truth, easy updates."
- "If no skills are found in standard locations, a recursive search is performed."

## Gaps / fetch notes

- Did not inspect source for lockfile (`skills-lock.json`) or SHA pinning; README sections 100-135/370-520 read, rest skimmed by grep. Install-count numbers are from skills.sh homepage on 2026-08-26.
