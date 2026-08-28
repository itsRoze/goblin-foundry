# Claude Code plugins + official marketplace

- **URL:** https://code.claude.com/docs/en/plugins-reference ; https://code.claude.com/docs/en/plugin-marketplaces ; https://github.com/anthropics/claude-plugins-official
- **Type:** skills/agents (packaging + distribution format)
- **Author/Org:** Anthropic
- **Researched:** 2026-08-26
- **Status/maturity:** Official marketplace repo 34.4k stars, 3.9k forks, Apache-2.0, 289 plugins in `marketplace.json`, pushed 2026-08-26 (daily activity). Plugin format stable, still growing (monitors/themes experimental, `defaultEnabled` v2.1.154+, `pluginRoot` v2.1.239+).

## One-paragraph summary

A Claude Code plugin is a directory (optionally with `.claude-plugin/plugin.json`) that bundles skills, agents, hooks, MCP servers, LSP servers, output styles, `bin/` executables, workflows, and experimental monitors/themes, installed at user/project/local/managed scope from a marketplace (`.claude-plugin/marketplace.json` in any git repo, npm, archive, or command source) or loaded in place from `~/.claude/skills/<dir>/` ("skills-dir plugins"). Skills inside a plugin are namespaced `/plugin:skill`, agents `@plugin:agent`, hook commands get `${CLAUDE_PLUGIN_ROOT}`/`${CLAUDE_PLUGIN_DATA}`. The official marketplace is a curated 289-entry index (mostly vendor `git-subdir`/`url` sources, ~25 Anthropic-internal under `plugins/`), including `mattpocock-skills`. Only the `skills/` component is portable to pi; hooks, agents, and MCP need translation into a pi extension/package.

## Core ideas / thesis

- Plugins are the **unit of distribution and trust**; skills are the unit of capability. One manifest, many component types, one enable switch.
- Marketplace = a JSON index in a git repo; any repo can be its own marketplace; org policy can allowlist/blocklist sources.
- Manifest is optional: a bare `skills/` tree with a `plugin.json` naming it is a valid plugin.

## Architecture & mechanics

### Layout
```
plugin-root/
├── .claude-plugin/plugin.json   # optional manifest
├── skills/<name>/SKILL.md       # adds to default skills dir
├── commands/*.md                # flat skills (legacy)
├── agents/*.md                  # subagents (name, description, model, effort, maxTurns, tools, disallowedTools, skills, memory, background, isolation: worktree)
├── hooks/hooks.json             # merged
├── .mcp.json | .lsp.json        # merged; scope name plugin:<plugin>:<server>
├── output-styles/, themes/, monitors/monitors.json, workflows/
├── bin/                         # added to PATH for Bash tool
├── scripts/, package.json (+ lockfile → auto `npm ci --ignore-scripts`, 60 s)
└── settings.json                # only `agent`, `subagentStatusLine`
```

### `plugin.json` (all fields)
`name` (required, kebab, immutable once published), `displayName`, `version`, `description`, `author{name,email,url}`, `homepage`, `repository`, `license`, `keywords`, `metadata` (ignored), `defaultEnabled`, component paths (`skills` adds to default; `commands|agents|workflows|outputStyles|experimental.themes|experimental.monitors` replace default; `hooks|mcpServers|lspServers` merge; all `./`-relative), `userConfig{key:{type: string|number|boolean|directory|file, title, description, sensitive, required, default}}` → `${user_config.KEY}` / `CLAUDE_PLUGIN_OPTION_<KEY>`, `channels[]`, `dependencies[]` (auto-enabled transitively). Unknown top-level fields ignored (errors with `--strict`).

### `marketplace.json`
```json
{ "name": "goblin", "owner": {"name": "..."}, "metadata": {"pluginRoot": "./plugins"},
  "plugins": [ { "name": "goblin-skills", "source": "./plugins/goblin-skills",
                 "category": "development", "strict": true, "defaultEnabled": true,
                 "skills": ["./skills/x"], "hooks": "./hooks.json" } ],
  "renames": {"old": "new"} }
```
Source types: relative `./path`; `{source: github, repo, ref, sha}`; `{source: url, url, ref, sha}`; `{source: git-subdir, url, path, ref, sha}`; `{source: npm, package, version, registry}`; `{source: archive, url, sha256}` (+`headers`/`headersHelper`); `{source: command, command, timeout, mode: copy|link}`. `strict: false` = marketplace entry is the whole definition (used for "skill-bundle" plugins pointing into a monorepo `packages/agent-skills`).

### CLI
```
claude plugin marketplace add owner/repo[@ref] | <git url> | ./dir | https://.../marketplace.json  [--scope user|project|local] [--sparse ...]
claude plugin install <name>@<marketplace> [-s scope] [--config k=v] [-y]
claude plugin enable|disable|update|uninstall|list [--json] |details <name>| validate <dir> [--strict] | tag | prune | init <name> --with skills,agents,hooks,mcp,lsp
```
Interactive: `/plugin`, `/plugin install x@claude-plugins-official`, `/reload-plugins`. Team sharing: `.claude/settings.json` → `extraKnownMarketplaces` + `enabledPlugins {"x@mkt": true}`; cloud sessions install repo-declared plugins at start. Org: `strictKnownMarketplaces`, `blockedMarketplaces`, `disableCommandPluginSources`, `disableSideloadFlags`.

### Caching / versions
Marketplace plugins copied to `~/.claude/plugins/cache/<name>/<version>/`; orphans pruned after ~14 days; symlinks outside marketplace skipped; version from `plugin.json` ← marketplace entry ← git tag (`claude plugin tag`). `claude plugin details` prints a **token-cost estimate** for the component inventory.

### Official marketplace repo
`plugins/` (Anthropic: `agent-sdk-dev`, `claude-code-setup`, `claude-md-management`, `claude-security`, `code-review`, `code-simplifier`, `commit-commands`, `feature-dev`, `frontend-design`, `hookify`, `code-modernization`, `explanatory-output-style`, LSP bundles `clangd/csharp/gopls/jdtls/kotlin-lsp`…), `external_plugins/` (asana, context7, discord, fakechat, firebase, github, gitlab, greptile, imessage…), and ~240 vendor entries by `git-subdir`/`url` (AWS, Azure, Databricks, Datadog, Grafana, Honeycomb, Cloudflare, Expo, Convex, Supabase-style DB plugins, security vendors, `coderabbit`, `dash0` OTel-for-Claude-sessions). Submission via https://clau.de/plugin-directory-submission. Categories: development, productivity, database, security, monitoring, deployment, design, testing, automation, migration, learning, location.

## Workflow: end to end (publishing our skill set)

1. Repo `goblin-foundry/skills` with `.agents/skills/<name>/SKILL.md` (canonical) and `.claude-plugin/plugin.json` `{ "name": "goblin", "skills": "./.agents/skills/", "hooks": "./claude/hooks.json", "agents": ["./claude/agents/reviewer.md"] }`; `.claude-plugin/marketplace.json` listing itself (`source: "./"`).
2. `claude plugin validate . --strict`; `skills-ref validate` per skill.
3. Users: `claude plugin marketplace add goblin-foundry/skills && claude plugin install goblin@goblin`; or `/plugin install goblin@claude-plugins-official` once accepted.
4. Same repo is `npx skills add goblin-foundry/skills` (marketplace manifest discovery) and `pi install git:github.com/goblin-foundry/skills` (pi reads `skills/` or `pi.skills` in package.json, so add `"pi": {"skills": ["./.agents/skills"], "extensions": ["./pi/extensions"]}`).

## Notable techniques worth stealing

- **Single repo, three manifests** (`plugin.json`, `marketplace.json`, `package.json#pi`) over one skills tree. Pocock does two of three.
- **Skills-dir plugins**: drop `.claude-plugin/plugin.json` into `~/.claude/skills/goblin/` for zero-install local dev (`goblin@skills-dir`).
- **`userConfig` + `${user_config.KEY}`** for tracker URLs/tokens instead of hard-coding in skills; pi equivalent is `settings.json` keys read by an extension.
- **`dependencies`** to make `goblin-skills` require `mattpocock-skills` rather than vendoring it.
- **Agents frontmatter `isolation: worktree`, `background`, `skills` preload**: the Claude-side analog of pi-subagents' worktree fan-out; keep our agent definitions as Markdown so the same file can seed both.
- **`claude plugin details` token cost** as a CI budget check.
- Anthropic's `hookify`, `claude-md-management`, `claude-code-setup`, `feature-dev`, `code-review` plugins are readable references for hook+agent bundling.

## Weaknesses / open questions / risks

- Only `skills/` is portable; `hooks/hooks.json` (Claude events/JSON contract), `agents/*.md` (Claude Agent tool), `.mcp.json`, output styles have no pi loader. See hooks-mastery-to-pi-mapping.md.
- Plugin `name` immutable; renames need `renames` map.
- Cache copy semantics break symlinked skills that point outside the marketplace (our symlink layout must keep targets inside the repo).
- Official-marketplace pins lag `main` (observed with Pocock's plugin).

## Fit for our agentic stack

Adopt the plugin format as the *Claude Code packaging* of the goblin skill set, generated from the pi-first tree, not the other way round. Concretely: `.agents/skills/` canonical; `pi/extensions/*.ts` for behavior (tool policy, telemetry, forced skill loading); `claude/hooks.json` + `claude/agents/*.md` as thin Claude adapters that call the same scripts (`scripts/*.sh|py`) the pi extension calls. One `scripts/` dir, two thin adapters. Validate both in CI.

## Related resources mentioned

- https://github.com/anthropics/claude-plugins-official/tree/main/plugins/hookify , `/plugins/feature-dev`, `/plugins/code-review`, `/plugins/claude-code-setup` — Anthropic reference plugins to read.
- `dash0` plugin — OpenTelemetry capture of Claude Code sessions via hooks; compare with pi-telemetry.
- https://code.claude.com/docs/en/sub-agents (agent frontmatter, `skills` preload), /docs/en/hooks.
- https://clau.de/plugin-directory-submission — submission form.

## Key quotes / references

- "Skills-directory plugins: Plugins loaded in place from `~/.claude/skills/` or `.claude/skills/` without marketplace or install step."
- "`strict: false`: Marketplace entry is complete definition; plugin cannot have `plugin.json` declaring components."
- "Symlinks... Outside marketplace: skipped for security."

## Gaps / fetch notes

- Read docs via WebFetch summaries + marketplace.json via raw GitHub (first ~140 of 289 entries listed). Did not open individual official plugins' hooks.json.
