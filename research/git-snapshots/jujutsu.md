# Jujutsu (jj) for agent workspaces

- **URL:** https://github.com/jj-vcs/jj — docs: https://docs.jj-vcs.dev/latest/ (old jj-vcs.github.io URLs 301 here)
- **Type:** VCS (git-compatible)
- **Author/Org:** jj-vcs org (Martin von Zweigbergk, Google-originated; community-run)
- **Researched:** 2026-08-26 (round 2; extends landscape.md row)
- **Status/maturity:** 31.2k stars, Apache-2.0, latest release v0.44.0 (2026-08-06), commits daily. Pre-1.0 but used in production by many; disk format stable-ish (migrations handled by CLI).

## One-paragraph summary

jj is a git-compatible VCS whose working copy *is* a commit: any `jj` command first snapshots the working copy into the current change (`@`), so there is no staging area, no "uncommitted work", and every state the tool ever saw is addressable. Each repo has an **operation log** (every command = one operation recording a full *view* of all refs/heads/working-copy commits) so `jj undo` / `jj op restore <id>` roll back *any* command including rebases and bookmark moves. Conflicts are stored as data inside commits (rebases never stop), changes have stable **change IDs** that survive rewrites, and **workspaces** give multiple working copies over one shared `.jj` store. It reads and writes normal git objects, pushes plain git branches ("bookmarks"), and can be colocated with a `.git` dir so ordinary git tooling still works.

## Core ideas / thesis

- Working copy = commit; snapshot on every command; nothing is ever "not in the repo".
- Op log = undo for the whole repo, not just per-branch reflog; lock-free concurrency (concurrent ops produce a merged view + "divergent" changes rather than corruption).
- Conflicts are first-class values; a rebase "succeeds" and records the conflict; descendants auto-rebase when you fix an ancestor.
- Change ID (stable) vs commit ID (content hash) — the agent-facing handle is the change ID.
- "Bookmarks" are names that do *not* auto-advance; you set them explicitly (`jj bookmark set`), which is actually good for agents (no accidental branch moves).

## Architecture & mechanics

**Data model**
- `.jj/repo/store` — commits/trees via the git backend (`.jj/repo/store/git` or the colocated `.git`).
- `.jj/repo/op_store` + `op_heads` — operations and views. A *view* = map of every bookmark/tag/git ref, set of heads, and each workspace's working-copy commit. An *operation* = view + metadata (timestamp, user@host, description, parents). Multiple op heads = concurrent ops, merged on next command.
- Git backend details: change IDs written into a non-standard git commit header (since 0.30; survive `commit --amend`, not `git rebase`); conflicts serialized as trees with `.jjconflict-base-N/` and `.jjconflict-side-N/` subdirs plus a `jj:trees` commit header; jj-created commits are kept alive with `refs/jj/keep` refs.
- Per-workspace: `.jj/working_copy` (tree state + which op it was last updated at). If a workspace's op lags the repo, it's *stale* → `jj workspace update-stale` (or `snapshot.auto-update-stale = true`).

**Snapshotting**
- Happens at the start of almost every command, *only then* (no daemon). `--ignore-working-copy` skips it; `--at-op <id>` also skips it.
- Force one: `jj util snapshot` (older posts say `jj status`; any command works). Watchman integration: `fsmonitor.backend = "watchman"` + `fsmonitor.watchman.register-snapshot-trigger = true` snapshots on filesystem change — the closest thing to DeltaDB-style continuous capture.
- `snapshot.auto-track = "all()"` (fileset; default all non-ignored), `snapshot.max-new-file-size = "1MiB"` (bigger new files error out unless `jj file track --include-ignored` or set 0), `.gitignore` respected (no `.jjignore`).

**Workspaces**
```
jj git init --colocate            # or jj git clone --colocate URL
jj workspace add --name agent-42 -r main --sparse-patterns copy ../ws/agent-42
jj workspace list -T 'name ++ " " ++ working_copy.change_id() ++ "\n"'
jj workspace root                 # inside a workspace
jj workspace update-stale
jj workspace forget agent-42 && rm -rf ../ws/agent-42
```
Each workspace has its own `@`; `@` in another workspace is `agent-42@`. Each workspace's working copy commit is a separate change. One repo can serve N workspaces; a workspace is single-writer.

**Op log**
```
jj op log -n 20 -T 'id.short() ++ " " ++ description ++ "\n"'
jj op show <opid> --stat
jj op diff --from <op1> --to <op2>
jj undo                # undo last op   (jj redo exists as of 0.4x)
jj op restore <opid>   # whole repo view back to that op (working copies re-synced)
jj op abandon <opid>   # gc old ops
jj log --at-op <opid>  # read-only time travel, no snapshot
```

**Conflicts**
- N-way: stored as one base snapshot + N side diffs; marker styles `ui.conflict-marker-style = "diff" | "snapshot" | "git"` (git style only 2-sided).
- `jj rebase` never stops; `jj log` shows `(conflict)`; fix with `jj new <conflicted>` → edit → `jj squash`, or `jj resolve --tool <name> [paths]`, or edit-in-place on the conflicted change. Descendants rebase automatically.
- Conflicted commits pushed to git look like weird trees — never push a conflicted change to a PR branch (gate on `jj log -r 'conflicts() & mine()'`).

**Trailers / provenance**
- `templates.commit_trailers` config adds trailers automatically to every description written by jj, e.g.
  ```toml
  [templates]
  commit_trailers = '''
  "Agent-Session: " ++ env("PI_SESSION_ID") ++ "\n" ++
  "Agent-Model: " ++ env("PI_MODEL") ++ "\n" ++
  "Change-Id: " ++ change_id
  '''
  ```
  (exact template functions vary by version; `format_signed_off_by_trailer` exists as a builtin example). pi exports `PI_SESSION_ID`, `PI_MODEL`, `PI_SESSION_FILE` into bash children so a jj-side trailer can read them.
- `--config user.name=... --config user.email=...` per invocation; `JJ_CONFIG` env can point at a factory TOML; `jj config set --workspace` for per-workspace values.

**Push**
```
jj bookmark create task/FOO-123 -r @-        # name the finished change
jj git push --bookmark task/FOO-123 --allow-new
jj git push --change @-                       # auto bookmark push-<changeid>; templates.git_push_bookmark customizes (e.g. "agent/" ++ change_id.short())
jj git fetch && jj rebase -d main@origin      # sync
```

**Not supported:** git hooks, submodules, LFS, `git worktree`, partial clones, `.gitattributes`, sparse checkout (own `--sparse-patterns` instead). No hook mechanism at all → all policy must live outside jj (in pi extension hooks).

## Workflow: end to end (agent in a jj workspace)

1. Orchestrator: `jj workspace add --name <task> -r main <dir>` (or in a fresh VM: `jj git clone --colocate` then `jj new main`).
2. Agent vocabulary (deliberately tiny): `jj new -m "<intent>"` to start, edit files, `jj describe -m` to refine message, `jj util snapshot` after each tool call (driven by a pi `tool_result` hook, not the model), `jj log`/`jj diff` to inspect.
3. Orchestrator on completion: `jj log -r 'conflicts()'` must be empty; `jj bookmark create task/<id> -r @-`; `jj git push --bookmark ... --allow-new`; open PR with `gh`.
4. Rollback of a bad turn: `jj op log` → `jj op restore <op-before-turn>` (or `jj restore --from <change>` for files only).
5. Integration: rebase stack `jj rebase -s <first> -d main@origin`, resolve conflicts once at the bottom, descendants follow.

## Notable techniques worth stealing

- **Snapshot-on-hook**: the pattern from panozzaj.com — run `jj status`/`jj util snapshot` from harness hooks (`SessionStart`, `PreCompact`, `PostToolUse`). In pi: a `tool_result` hook that `exec`s `jj util snapshot --quiet`. Gives tool-call-granular, content-addressed, undoable checkpoints without inventing a journal format.
- **Watchman trigger** for continuous capture in long bash steps.
- **Operation ID as checkpoint token**: store `jj op log -n1 -T 'id'` in the pi session (`pi.appendEntry("checkpoint", {op})`) so `/fork` + `jj op restore` restore code and conversation together.
- **`--at-op` for post-hoc audit**: reviewers can view the repo exactly as the agent saw it at turn N without touching the working copy.
- **Conflicts as data** → orchestrator can *detect* and *route* conflicts (dispatch a "resolve" agent onto a conflicted change) instead of a rebase blowing up mid-script.
- **geirsson.com "local autonomous GitHub"**: N workspaces = N agents; a merge-skill lets an agent cherry-pick/rebase/squash across workspaces via revsets; rule "never edit a change that is an ancestor of another workspace's @" (else stale working copies); aggressively `jj abandon` dead experiments.
- **Agent-safe skills**: netresearch/jujutsu-workflow-skill (jj local, git canonical; `jj new`→`describe`→`bookmark`→push; forbid absorb/reset), antstanley/jj-workspace-skill (intercepts "use worktree" requests → `jj workspace add`), mtaran/jj-guide.
- **agentjj post-mortem** (2389-research, archived 2026-02): jj's *ergonomic* features bit agents — `absorb`/auto-squash merged multi-step history; single-writer working copy bundled two agents' edits into one change when they shared a workspace; colocated mode confused agents that also ran `git` (files "deleted" in git index). Their conclusion "jj solves human problems" is really "don't give an agent jj's history-editing verbs and don't share a workspace". Their staging-area point (agents need *selective* commits) is answered in jj by `jj commit <paths>` / `jj split <paths>` (both non-interactive).

## Weaknesses / open questions / risks

- Snapshot only on command → still need hooks/watchman; a crash mid-bash loses the tail.
- No hooks, no LFS, no submodules; `git worktree` and jj workspaces are mutually exclusive on a repo.
- Colocated + agents running raw `git` = the agentjj failure mode. Either ban `git` write commands in the tool policy or use non-colocated repos in agent VMs.
- Hangs of several minutes with many workspaces reported (geirsson); unclear cause.
- Stale-workspace errors if an orchestrator rewrites an ancestor of a live workspace's `@`.
- Op-store growth with per-tool-call snapshots (thousands of ops/day per agent) — need `jj op abandon`/gc policy; untested at that rate.
- Change-ID header does not survive `git rebase` by GitHub's merge queue → provenance must live in trailers, not change IDs.

## Fit for our agentic stack (pi, one cloud VM per agent)

Because isolation is per-VM, **workspaces stop mattering**; each VM is a clone. What still matters:
- **Snapshots/undo inside the VM: strong yes.** `jj git clone --colocate` (or non-colocated to avoid the git-index confusion) in the VM; pi extension hook on `tool_result` runs `jj util snapshot --quiet`; on `turn_end` record the op ID as a session entry. Rollback = `jj op restore`. This replaces the `git write-tree` journal hack in landscape.md with zero custom format.
- **Agent vocabulary**: allow `jj new|describe|log|diff|status|commit <paths>|split <paths>|restore|resolve`; deny `absorb|squash --into|abandon|op restore|git push` for the model (orchestrator does those). Implement via pi `tool_call` hook regex on `bash`.
- **Branch naming**: bookmark `agent/<task-id>/<change-id-short>` set by orchestrator; `templates.git_push_bookmark` for `--change` pushes.
- **Provenance**: `templates.commit_trailers` reading `PI_SESSION_ID`/`PI_MODEL` env → trailers survive squash-merge only if the merge commit message carries them (PR body template must copy them).
- **Merge**: push bookmarks as plain git branches; everything downstream (stacks, merge queue) is git/GitHub-native (see stacking-and-merge-queues.md). jj is invisible to CI.
- **Skip**: multi-workspace choreography (geirsson) — the VM boundary already gives it; conflicts-as-data across agents only helps if agents share a repo store, which they don't. Keep an eye on `jj-lib` embedding if pi-server ever hosts sessions centrally.

## Related resources mentioned

- https://geirsson.com/jj-workspaces — parallel agents in jj workspaces + merge skill gist
- https://www.panozzaj.com/blog/2025/11/22/avoid-losing-work-with-jujutsu-jj-for-ai-coding-agents/ — hook-driven snapshots
- https://github.com/2389-research/agentjj — post-mortem (archived)
- https://github.com/netresearch/jujutsu-workflow-skill , https://github.com/antstanley/jj-workspace-skill , https://github.com/mtaran/jj-guide — agent skills
- https://docs.jj-vcs.dev/latest/git-compatibility/ , /config/ , /operation-log/ , /conflicts/ , /working-copy/
- https://ddbeck.com/notes/jj-git-push-bookmark-template/ — bookmark naming template
- https://arxiv.org/html/2604.02547v1 — (search hit) paper touching jj + agents, unread

## Key quotes / references

- "Most jj commands you run will commit the working-copy changes if they have changed." (working-copy doc)
- "the conflict will be recorded in the rebased commit and the rebase operation will succeed" (conflicts doc)
- "Never edit a jj change that is an ancestor of another workspace" (geirsson)
- "What jj correctly identifies as friction for humans is the mechanism agents need for selective commits." (agentjj)
