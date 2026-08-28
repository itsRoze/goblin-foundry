# Zed Delta (+ DeltaDB)

- **URL:** https://zed.dev/blog/introducing-delta (product), https://zed.dev/blog/introducing-deltadb (data layer), https://delta.dev (app / signup)
- **Type:** blog (product announcement) — versioning/provenance layer + multiplayer agent UI
- **Author/Org:** Zed Industries (Nathan Sobo, CEO). Sequoia-backed.
- **Researched:** 2026-08-26
- **Status/maturity:** Private beta since 2026-08-12 (invites rolling out "over the coming weeks"). DeltaDB waitlist opened 2026-06-11. No pricing published. No open-source license announced for DeltaDB or Delta (press describes DeltaDB as "proprietary"; the Zed editor itself remains GPL/AGPL). No public GitHub repo for DeltaDB found. HN: DeltaDB post ~340 pts / 183 comments (item 49187256); Delta post item 49276574.

## One-paragraph summary

Delta is a standalone "multiplayer environment for coding with agents and reviewing what they build", shipped as a native Rust desktop app and the identical binary compiled to WebAssembly/WebGL at delta.dev. Underneath it is DeltaDB, an operation-based CRDT version-control layer that records every edit as a fine-grained, stably-identified *delta* rather than a commit snapshot, and records each agent/human message side-by-side with the edits it produced. DeltaDB sits *between* your git commits: you keep the git repo, commit and push as before, and DeltaDB captures the full edit+conversation history that git throws away. Agents (starting with Claude Code, via the Agent Client Protocol) run in real files in a terminal; their sessions sync live into a Delta "thread" that teammates can join, comment on (any line of code, any diff, any reasoning block), and hand off, with comments anchored to deltas so they survive as code moves.

## Core ideas / thesis

- "Software now takes shape in the conversation, not the commit." Git snapshots the *result*; the *process* (prompt -> edit -> re-prompt) is where design decisions actually live, and it is lost today.
- "Software is made between commits." Version at the operation level, not the commit level; every operation gets a stable identity you can address, rewind to, and link from.
- Code and conversation must live in one replicated store, so provenance is bidirectional: from any past message jump to the code as it was *at that moment* or as it is now; from any line find the conversation that wrote it and every conversation that has touched it since.
- PRs, review threads and inline comments are "ceremony to reattach a discussion to code after the fact"; if they share a store, "the ceremony disappears".
- Agents are first-class readers of this history: "They pick up the context behind the code they're touching."
- Do not fight git: "Git and CI stay for what they're good at: running checks and connecting you to the rest of the world."

## Architecture & mechanics

Components (as far as public material reveals; no docs/CLI reference is public yet):

- **DeltaDB** — "replicates the conversation and the worktree together, in real time, for everyone in a thread." Built on operation-based CRDTs (the same lineage as Zed's collaborative-editing engine). Unit of history = a *delta* (one editing operation) with a stable ID. Messages and the edits they produced are stored adjacently in the same log.
- **Virtualized worktree** — the worktree is a CRDT replica; "the files are real: agents work in them through a terminal, and you can mount the whole worktree to disk whenever you want your own tools on it." Press coverage of the June post also claims instantaneous branching at any point in history because the worktree is virtual.
- **Delta-anchored references** — code references (comments, links) point at a delta, not a line number, and "survive as the code moves underneath".
- **Thread** — the unit of collaboration: one agent conversation + its worktree replica + comments. Private until shared; invite teammates in one click; everyone sees real-time synchronized code on their own machine.
- **Git bridge** — DeltaDB "works with the git repository you already have. Every edit and conversation is captured *between* your commits", and you "commit and push like you always did." Public material does not describe import/export format, how deltas map to commits, or whether DeltaDB history can be reconstructed from git alone (it cannot, by design — that is the point).
- **Agent harness integration** — "Delta connects to other agent harnesses, starting with Claude Code": a terminal Claude Code session syncs live into a Delta thread via ACP (Agent Client Protocol, Zed's open protocol also used by the Zed editor's agent panel). The transcript, diffs and reasoning stream in at model emission speed; Delta deliberately renders *everything* (full diffs, full transcripts) instead of collapsing/summarizing.
- **Cloud runners** — a thread's work can be moved to a cloud runner; the agent keeps going and code+conversation keep syncing.
- **UI** — thread is navigated with editor keybindings ("put your cursor on it and start typing" to reply); comments can target a diff hunk, a plan step, or a reasoning block, and that precise target is communicated to both agents and humans.
- **Distribution** — native Rust (GPUI) desktop app; same binary compiled to Wasm + WebGL for delta.dev ("not a second-class version of Delta built in JavaScript and HTML").

Concrete file paths / commands: none published. No CLI, no SDK, no schema, no self-hosting story yet.

## Workflow: end to end

1. Open Delta (desktop or delta.dev), open a git repo; DeltaDB starts recording the worktree as a delta stream on top of the current commit.
2. Start an agent thread (Zed's built-in agent, or run `claude` in a terminal attached to the thread via ACP). Every prompt, reasoning block, tool call and file edit is recorded as deltas linked to the message that caused them.
3. While the agent works, you (or a teammate you invited) scroll the thread with editor motions, put the cursor on a diff hunk / plan step / reasoning block, and type a comment. The agent receives the precisely-targeted comment as feedback.
4. Teammates join mid-flight (no commit/push needed), see the same live worktree, can talk to the same agent, annotate, or take over.
5. Optionally move the thread to a cloud runner and walk away; sync continues.
6. When happy, commit and push with plain git as usual. The commit is the "publish" step; DeltaDB keeps the full between-commit history and conversation, addressable forever from the code.
7. Later: from any line, jump back to the conversation that produced it (and later ones that touched it); ask a new agent a question and it has that context.

## Notable techniques worth stealing

- **Record prompt and edit side-by-side, as one log.** Even without CRDTs, a factory can append `{message_id, tool_call_id, file, patch}` records to a per-task journal so every hunk is traceable to the exact turn that produced it.
- **Stable IDs per edit operation, not per commit.** Gives rewind granularity finer than "before this prompt"; cheap to emulate with per-tool-call git snapshots (`git stash create` / temp commits / `git write-tree`) keyed by tool_call_id.
- **Anchor review comments to a change, not a line number.** Store comments against a blob hash + hunk fingerprint (or a commit + path + content anchor) so they survive rebases; git's `blame`/`--follow` can approximate.
- **Bidirectional provenance queries**: "which conversation wrote this line" (blame -> commit -> session id in trailer) and "what does this line look like now" (message -> file@then vs file@HEAD).
- **Render everything, don't summarize**: full transcripts and full diffs at stream speed; collapsing hides the evidence a reviewer needs.
- **Comments targeted at plan steps and reasoning blocks, not just code.** A review surface for *intent* is a distinct thing from a code diff review.
- **Same-binary web client** (Rust->Wasm) — not applicable to us, but "the reviewer needs no install" is a real adoption lever for non-engineer stakeholders reviewing agent work.
- **ACP as the harness boundary**: they integrate Claude Code without forking it. We can do the same: wrap `claude` sessions in a recorder rather than modifying the harness.

## Weaknesses / open questions / risks

- **Closed and unavailable.** Private beta, no license, no self-host, no API/CLI, no data-export story. A provenance layer whose history cannot be reconstructed from git is a lock-in risk by construction.
- **Not designed for headless/CI agents.** Everything shown is a GUI thread with a human in the loop. Nothing indicates a programmatic API for a scheduler running 50 agents with no UI attached.
- **Provenance depends on agents editing through Delta-visible channels.** Claude Code syncs via ACP; edits made by arbitrary shell commands presumably still land in the CRDT worktree (it watches files), but attribution of a shell-side `sed` to a specific tool call is unclear.
- **Git mapping undocumented**: how deltas become commits, what happens on `git rebase`/`checkout` under the CRDT worktree, whether DeltaDB survives history rewrites, how a repo already in flight on another machine is reconciled.
- **Storage growth**: every keystroke-level operation plus full transcripts for every agent run, forever. Hosting/retention policy unknown.
- **HN sentiment**: strong skepticism that Zed should be building a VCS before fixing editor basics (external file-change detection, Wayland/WSL bugs); "is coding really multiplayer?"; "transcripts as the decision record become unnavigable" vs PRs; JetBrains Local History already covers "between commits" for one machine; comparisons to Fossil (VCS+wiki+tickets in one). No Zed staff replies in either thread.
- **Single-vendor gravity**: works best with Zed's agent and Zed's UI; Claude Code is supported but as a guest.

## Fit for our agentic stack

Assumption: Claude Code-centric factory, many parallel agents in git worktrees, need checkpoints, rollback, attribution.

- **Adopt now: no.** Not obtainable (private beta), not scriptable, not self-hostable, and the git relationship is undocumented. It cannot be the git/snapshot layer for a headless fleet today.
- **Adopt the *model*: yes.** DeltaDB's data model is the right target for our provenance layer, and every piece of it is emulable on plain git plus a sidecar journal:
  - Per-tool-call snapshot: after each Edit/Write/Bash (via PostToolUse hook) run `git add -A && git write-tree` in the agent's worktree and append `{session_id, turn, tool_call_id, tree_sha, parent_tree_sha}` to `.factory/journal.jsonl`. That is a "delta stream" with stable IDs, git-native, and it costs nothing at rest (dangling trees get GC'd unless we ref them under `refs/factory/<session>/<n>`).
  - Attribution: commit trailers `Agent-Session:`, `Agent-Model:`, `Agent-Turn:`; `git blame` -> commit -> trailer -> transcript file. That is DeltaDB's line->conversation link.
  - "Code as it was when the agent wrote it": resolved by the journal's tree_sha.
  - Rewind at tool-call granularity: `git read-tree refs/factory/<session>/<n> && git checkout-index -af`.
- **Watch: yes.** If DeltaDB gains an API/CLI or self-host, it would be a candidate for the *review surface* (humans commenting on plan steps / reasoning, teammates joining an agent mid-flight) rather than the storage layer. Its Claude Code/ACP path means our agents could later be mirrored into it without changing the factory.
- **Skip**: the multiplayer/live-thread UI is orthogonal to a factory whose agents mostly run unattended; our review surface is the PR.

## Related resources mentioned

- https://zed.dev/blog/introducing-deltadb — the data-model post (June 11, 2026); worth its own careful read when docs appear.
- https://zed.dev/deltadb — waitlist / product page.
- https://zed.dev/roadmap — Zed roadmap incl. DeltaDB/Delta milestones.
- https://zed.dev/blog/sequoia-backs-zed — earlier post that first described the DeltaDB idea.
- Agent Client Protocol (ACP), https://agentclientprotocol.com — the open protocol by which Claude Code sessions sync into Delta; relevant to us as a harness-neutral way to observe/record Claude Code sessions.
- Hanselminutes #1049 "The space between the commits" (Nathan Sobo) https://hanselminutes.com/1049/... and Syntax.fm #1029 — longer-form explanations of DeltaDB.
- HN threads: https://news.ycombinator.com/item?id=49187256 (DeltaDB), https://news.ycombinator.com/item?id=49276574 (Delta).
- JetBrains Local History — repeatedly cited on HN as the single-machine "between commits" prior art.
- Fossil SCM — cited as prior art for VCS+discussion in one store.

## Key quotes / references

- "Software now takes shape in the conversation, not the commit. DeltaDB is the version control built for that." (DeltaDB post)
- "DeltaDB works with the git repository you already have. Every edit and conversation is captured *between* your commits." (Delta post)
- "From any line of code, you can find the conversation that produced it and every conversation that has touched it since." (DeltaDB post)
- "The files are real: agents work in them through a terminal, and you can mount the whole worktree to disk whenever you want your own tools on it." (DeltaDB post)
- "Pull requests, review threads, and inline comments exist to reattach a discussion to code after the fact because the discussion and the code lived in separate places. Put them in the same place, and the ceremony disappears." (DeltaDB post)
- "Delta connects to other agent harnesses, starting with Claude Code." (Delta post)
- "Delta.dev isn't a second-class version of Delta built in JavaScript and HTML... the same Rust application, compiled to WebAssembly and rendered through WebGL." (Delta post)

### Gaps
- Could not retrieve: pricing, license, storage/hosting model, git import/export mechanics, any API/CLI. zed.dev/deltadb page itself not fetched (waitlist page). HN Delta thread fetched only via zeli.app mirror; HN DeltaDB thread fetched directly.
