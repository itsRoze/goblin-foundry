# Agent Skills specification (agentskills.io)

- **URL:** https://agentskills.io/specification ; https://github.com/agentskills/agentskills
- **Type:** skills/agents (open format spec)
- **Author/Org:** Originated by Anthropic, released as an open standard; governed via the `agentskills/agentskills` repo + Discord
- **Researched:** 2026-08-26
- **Status/maturity:** `agentskills/agentskills` 24.7k stars, 1.8k forks, Apache-2.0, pushed 2026-08-09. `anthropics/skills` (reference skill library) 171.8k stars. ~45 products on the client showcase. Reference validator `skills-ref`.

## One-paragraph summary

A skill is a directory with a `SKILL.md` (YAML frontmatter + Markdown body) plus optional `scripts/`, `references/`, `assets/`. Six frontmatter fields, only `name` and `description` required. The contract with the agent is *progressive disclosure*: agents inject only `name`+`description` of every skill at startup (~100 tokens each), load the full body when a task matches (<5k tokens recommended, <500 lines), and read bundled files on demand. It is deliberately minimal so the same folder works in Claude Code, pi, Codex, Cursor, Amp, Copilot, Gemini CLI, OpenCode, Goose, etc. Everything richer (invocation control, hooks, subagent forking, argument substitution) is a per-harness extension, which is where portability breaks.

## Core ideas / thesis

- **Package procedural knowledge as version-controlled folders**, not tool servers. "Build a skill once and use it across any skills-compatible agent."
- **Three-stage loading**: Discovery (metadata) → Activation (body) → Execution (scripts/references). The description is the routing key; write it as "what + when" with trigger keywords.
- **Description quality is the whole game**: spec's good/poor examples ("Extracts text and tables from PDF files... Use when working with PDF documents" vs "Helps with PDFs").
- **Keep references one level deep** from SKILL.md; no nested reference chains.

## Architecture & mechanics

### Directory
```
skill-name/
├── SKILL.md          # required
├── scripts/          # optional executables (Python/Bash/JS; agent-dependent)
├── references/       # optional docs loaded on demand (REFERENCE.md, FORMS.md, domain files)
└── assets/           # optional templates, images, data
```

### Frontmatter (the full spec)

| Field | Req | Constraint |
|---|---|---|
| `name` | yes | 1-64 chars, `[a-z0-9-]`, no leading/trailing/consecutive hyphens, **must match parent dir name** |
| `description` | yes | 1-1024 chars, what + when |
| `license` | no | short name or bundled file reference |
| `compatibility` | no | 1-500 chars, env requirements (product, packages, network). "Most skills do not need it" |
| `metadata` | no | string→string map; use unique keys |
| `allowed-tools` | no | space-separated pre-approved tools, e.g. `Bash(git:*) Bash(jq:*) Read`. **Experimental**, support varies |

Body: free-form Markdown; recommended sections are steps, I/O examples, edge cases. Relative paths from skill root (`references/REFERENCE.md`, `scripts/extract.py`).

Validation: `skills-ref validate ./my-skill` (checks frontmatter + naming).

### Who implements it (client showcase, 2026-08)

Coding agents: Claude Code, Claude (claude.ai/API), ChatGPT & Codex, Cursor, Amp, GitHub Copilot, VS Code, Gemini CLI, OpenCode, OpenHands, Goose, Roo Code, Junie (JetBrains), Kiro, Factory, Mux (coder), Emdash, Ona, Letta, Firebender, Autohand, Trae, Mistral Vibe, Command Code, VT Code, Qodo, Tabnine, Superconductor, Deep Code, Pulumi Neo, Snowflake Cortex Code, Databricks Genie Code, Laravel Boost, Spring AI, **pi** (`instructionsUrl` points at pi-mono `docs/skills.md`), plus personal-agent runtimes (OpenClaw, Hermes Agent, nanobot, ZeroClaw, bub, fast-agent, Google AI Edge Gallery, Agentman, Vita, Piebald, Workshop).

### How pi loads skills (confirmed from `packages/coding-agent/docs/skills.md`)

Locations, in discovery order:
- Global: `~/.pi/agent/skills/`, `~/.agents/skills/`
- Project (only after trust via `trust.json` / `--approve` / `defaultProjectTrust`): `.pi/skills/`, and `.agents/skills/` in cwd **and every ancestor up to the git root**
- Packages: `skills/` dir or `pi.skills` in `package.json` (`pi install npm:…|git:…|/abs/path`)
- Settings: `"skills": ["~/.claude/skills", "~/.codex/skills"]` array in `~/.pi/agent/settings.json`; project `.pi/settings.json` can hold `["../.claude/skills"]`
- CLI: `--skill <path>` (repeatable, still loads with `--no-skills`)

Discovery rules: directories containing `SKILL.md` are found recursively in every location; bare root `.md` files count as skills in `~/.pi/agent/skills/` and `.pi/skills/` if they have frontmatter with a description; in `.agents/skills/` root `.md` files are ignored but nested `.md` in grouping folders are honored. Name collisions: warn, first wins. Missing description → not loaded. Unknown frontmatter → silently ignored.

Frontmatter pi honors: `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`, **plus `disable-model-invocation: true`** (hides from system prompt; only `/skill:name` loads it). pi **does not require `name` == dir name** (explicit divergence "for shared skill directories used across multiple agent harnesses").

Runtime: descriptions rendered into the system prompt as the spec's XML block; the model calls `read` on `SKILL.md` when relevant ("models don't always do this; use prompting or `/skill:name` to force it"); `/skill:name args` appends `User: <args>` to the loaded content; `enableSkillCommands` setting toggles the slash commands. Extensions can add skill paths via the `resources_discover` event / `DefaultResourceLoader`.

### How Claude Code extends it

Locations: `~/.claude/skills/<name>/SKILL.md`, `.claude/skills/<name>/` (root and every parent up to repo root; nested subdirs lazily when files there are touched, qualified as `apps/web:deploy`), `.claude/commands/*.md` (legacy, same thing), plugins (`plugin:skill`), enterprise managed dir, `--add-dir` dirs, `~/.claude/skills/synced/` (claude.ai). Symlinked skill dirs are followed. Precedence: personal > project > plugin; a project skill shadows a bundled one.

Extra frontmatter: `when_to_use` (appended to description; combined cap **1,536 chars** in the listing), `argument-hint`, `arguments` (named `$name`), `disable-model-invocation`, `user-invocable: false`, `allowed-tools` (turn-scoped grant, **not gated by workspace trust**), `disallowed-tools`, `model`, `effort`, `context: fork` + `agent` + `background`, `hooks` (registered on invoke, `once`), `paths` (glob-gated auto-activation), `shell`. Body extras: `$ARGUMENTS`, `$0`/`$1`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}`, and `` !`cmd` `` dynamic context injection (runs before the body is sent). Invoked skill content stays in context for the session; compaction re-attaches the last invocation (first 5k tokens). Skill dirs are file-watched; edits apply live.

Portability warning straight from the docs: the Skills API / claude.ai upload / `package_skill.py` paths **reject** non-spec keys (`Unexpected key(s) in SKILL.md frontmatter: argument-hint. Allowed properties are: allowed-tools, compatibility, description, license, metadata, name`).

## Workflow: end to end

1. `mkdir -p .agents/skills/<name>` (works in pi, Claude Code via `skills` CLI symlink or `.claude/skills` symlink, Codex, Cursor, Amp...).
2. Write `SKILL.md`: spec-only frontmatter (`name`, `description`, optional `metadata`, `allowed-tools`); body < 500 lines; heavy material in `references/`; executables in `scripts/`.
3. `skills-ref validate ./<name>` (and `claude plugin validate --strict` if bundled).
4. Test in pi: `pi --skill ./.agents/skills/<name>` then `/skill:<name>`; test in Claude Code with `/<name>`.
5. Distribute: git repo + `npx skills add owner/repo` (see skills-sh-registry.md) and/or a Claude Code plugin manifest (see claude-code-plugins.md).

## Notable techniques worth stealing

- **Spec-only frontmatter as the portability line.** Everything the factory's shared skills need can be expressed in `name`/`description`/`metadata`/`allowed-tools`; put harness-specific behavior in `metadata` keys our own tooling reads (e.g. `metadata: {goblin-invocation: user, goblin-phase: implement}`) rather than Claude-only keys.
- **`disable-model-invocation` is the one non-spec key both pi and Claude Code honor identically.** Safe to use.
- **`.agents/skills/` is the lingua-franca path**: pi walks it up to git root, Claude Code doesn't read it natively but `npx skills` symlinks into `.claude/skills/`, and pi can be pointed at `.claude/skills` via settings. Pick `.agents/skills/` as canonical and symlink.
- **Description = router.** pi has no 1,536-char cap but the model still has to pick from a list; Claude Code truncates at 1,536. Front-load the trigger.
- **`allowed-tools` as a self-contained permission grant** (Claude Code) vs pi where `allowed-tools` is parsed but permission is an extension concern (`tool_call` hook). A pi extension could read `allowed-tools` from the loaded skill and auto-approve matching calls; that's the parity gap to close.
- Anthropic's own `skill-creator` skill + `package_skill.py` in `anthropics/skills` for scaffolding/validation.

## Weaknesses / open questions / risks

- The spec says nothing about invocation control, arguments, hooks, or composition ("Call the Skill tool with X"): every harness invents its own; pi has no Skill tool, so cross-skill calls become "read `.agents/skills/x/SKILL.md`".
- `name` must equal dir name per spec; pi relaxes it, Claude Code uses dir name for the command. Keep them equal anyway.
- Security: skills are arbitrary instructions plus executable scripts; pi's docs and Claude Code's `allowed-tools`-not-trust-gated note both flag this. Supply-chain risk grows with `npx skills add`.
- pi's "models don't always read the file" caveat: model-invoked skills are less reliable in pi than in Claude Code (which has a Skill tool). Factory prompts should explicitly force `/skill:` or inject the body.
- No spec-level versioning or dependency declaration; `metadata.version` is convention only.

## Fit for our agentic stack

The Agent Skills folder is the right unit for goblin-foundry's capability layer: it is the only thing that is literally identical in pi and Claude Code. Rules for a pi-first, Claude-compatible set:
1. Canonical location `<repo>/.agents/skills/<name>/SKILL.md`; name == dir; spec frontmatter + `disable-model-invocation` only; anything else via `metadata.goblin-*`.
2. Body is harness-neutral: refer to other skills by path, not "Skill tool"; refer to scripts by relative path (works in both; Claude's `${CLAUDE_SKILL_DIR}` is optional sugar we avoid).
3. Ship a tiny pi extension that (a) reads `allowed-tools` and auto-allows in `tool_call`, (b) force-loads role skills per task via `resources_discover`/`before_agent_start` so AFK workers don't depend on the model choosing to `read`.
4. Ship a Claude Code plugin manifest over the same tree for `/goblin:<skill>` namespacing (see claude-code-plugins.md).
5. Validate in CI with `skills-ref validate` + `claude plugin validate --strict`.

## Related resources mentioned

- https://github.com/agentskills/agentskills/tree/main/skills-ref — reference validator/loader library.
- https://github.com/anthropics/skills — Anthropic's public skill library (docx/pdf/pptx/xlsx, frontend-design, skill-creator, `package_skill.py`).
- https://agentskills.io/integrate-skills — the XML system-prompt format pi follows.
- https://github.com/badlogic/pi-skills — Zechner's skill set (brave-search, browser automation, Google APIs, transcription).
- Per-client docs worth diffing for extension keys: Codex (`developers.openai.com/codex/skills`, `agents/openai.yaml`), Cursor, Amp manual, Gemini CLI, OpenCode, Copilot.

## Key quotes / references

- "Keep your main `SKILL.md` under 500 lines. Move detailed reference material to separate files." (spec)
- "Pi allows skill names to differ from their parent directory even though the standard disallows it; that rule is suboptimal for shared skill directories used across multiple agent harnesses." (pi docs)
- "When a task matches, the agent uses `read` to load the full SKILL.md (models don't always do this; use prompting or `/skill:name` to force it)." (pi docs)
- "Workspace trust doesn't gate this field... A skill can grant itself broad tool access, so review the `allowed-tools`." (Claude Code docs)

## Gaps / fetch notes

- Did not read `skills-ref` source or the `integrate-skills` page (XML format details). Client list is from the showcase page's JS data, not verified per client.
