# Provenance of AI-generated code: Zed Delta, "Cursor Origin," and prior art

Research date: 2026-08-19. Note: this session's WebSearch budget was exhausted early (200/200 used by a prior turn), so this research relies entirely on **WebFetch** against known/guessed URLs rather than open-ended search. Where I could not verify a claim with a fetched page, I've flagged it explicitly rather than asserting it as fact.

---

## 1. Zed Delta / DeltaDB

Source: [zed.dev/blog/introducing-delta](https://zed.dev/blog/introducing-delta)

### What it is

Delta is **not** a Git replacement and **not** primarily a database product you'd adopt standalone — it's a new multiplayer coding application from Zed, built on top of a new underlying replicated database called **DeltaDB**.

> "a multiplayer environment for coding with agents and reviewing what they build"

DeltaDB is the storage/sync engine; Delta is the application (available as a native Rust app and in-browser via WASM/WebGL) built on it. The Zed team deliberately built Delta as a **new, separate application** rather than folding DeltaDB into the Zed editor:

> The team chose to build Delta as "a new application, engineered around its replicated abstractions from day one" rather than adding DeltaDB to Zed directly, so that "the database and its first application could shape each other."

### What it records

DeltaDB's core move is capturing **the conversation and the worktree as one replicated object, continuously** — not just the end-state diff:

> "replicates the conversation and the worktree together, in real time, for everyone in a thread"

> "Every edit and conversation is captured *between* your commits."

This means it's not just keystrokes or just prompts — it's the full interleaving of chat/agent turns and the resulting file edits, captured live, not reconstructed after the fact from a diff. Comments are addressable against either the conversation or any line of code:

> Users "can comment on anything: the conversation, or any line of code in the worktree" — comments stay "anchored to the code as it evolves, connected to the conversations that produced it," whether "an agent touched it yesterday or a human wrote it three years ago."

The explicit design rationale is preserving *why*, not just *what*:

> "that context helps future teammates and agents understand not only what the code does, but why it took its current shape"

### Data model

Thread-centric: "The thread is where software happens now." A thread bundles conversation turns, diffs/worktree state, and anchored comments into one continuously-synced document that multiple humans and agents can be present in simultaneously (hence "multiplayer"). Zed frames this as an extension of the same idea as Google Docs' operational-transform/CRDT-style replication, applied to code + conversation instead of just text — consistent with Zed's existing collaborative-editing heritage (Zed the editor already uses CRDTs for multiplayer editing).

### Relationship to Git

Companion layer, explicitly **not** a replacement:

> "DeltaDB works with the git repository you already have."

> "You can commit and push like you always did, and teammates who never open Delta see a normal git repo."

So Git commits remain the interop boundary with the rest of the world; DeltaDB captures the finer-grained, higher-fidelity history *between* those commits (the agent back-and-forth, intermediate edits, review comments) that Git was never designed to hold.

### Agent integration

Delta connects to external agent harnesses rather than only running its own:

> Delta "connects to third-party agent harnesses, starting with Claude Code."

Within a thread, "the agent [is] right there in the thread, working from the same original conversation" — i.e., the agent is a first-class participant alongside humans in the same replicated conversation+worktree object, and teams can "invite your team into the conversation with a click." There's also a cloud-runner mode: you can "move your work to a cloud runner" and "the agent keeps going while its conversation and code stay synchronized" back to the local/replicated thread.

### Status / availability / pricing

**Private beta**, invite-gated, just launched:

> "The first invites to the private beta have gone out today. We'll be inviting more users over the coming weeks."

The blog post gives **no information on**: open-source status/license, pricing, or a public API/CLI for third-party read/write access to DeltaDB. As of this post, there is no documented way for an external tool (like a ticket system or CI pipeline) to programmatically write into or query DeltaDB — it's presented as an end-user application (native + browser), not an integration platform, and the only stated integration point is "third-party agent harnesses, starting with Claude Code" (i.e., Delta calls out to agents, not the reverse). Given it's day-one private beta, this is likely to change, but nothing about a public schema, SDK, export format, or self-hosting story is documented yet.

**Bottom line for the factory's purposes:** Delta/DeltaDB is a promising *reference design* (continuous, replicated, conversation+worktree-as-one-object, anchored comments, Git as the durable boundary) but is not currently a piece of infrastructure you could integrate with — it's a closed private-beta product with no public API.

---

## 2. "Cursor Origin"

This is real, but **it is not** a conversation/provenance-tracking system — it's a **Git hosting platform** (a GitHub/GitLab alternative built by Cursor/Anysphere), just announced. If the user's mental model was "Cursor has a Delta-like conversation-snapshotting layer," that's not quite what shipped — Origin is squarely infrastructure for hosting and scaling Git repos for agent-heavy workflows, with only a general, git-level ("every push is auditable") notion of provenance, not per-prompt/per-conversation snapshotting.

### Sources
- [cursor.com/changelog](https://cursor.com/changelog) — entry dated **Aug 17, 2026**, "Cursor can now host your code" (canonical entry: `cursor.com/changelog/origin-code-hosting`)
- [cursor.com/blog/git-at-any-scale](https://cursor.com/blog/git-at-any-scale) — **Aug 18, 2026**, by Vicent Martí, ~27 min read, the deep technical companion post

### What it is

> "Cursor can now host your code."

> "Origin begins rolling out today in early beta on all paid plans."

> "We're starting with the essentials, designed for agent scale: repos, pull requests, code browsing, and GitHub sync."

Origin is a hosted-repo product living under a new "Codebase" tab in Cursor:

> "The new **Codebase** tab is home for Origin repos."

> "Your GitHub repos can sit alongside the ones Cursor hosts." / "Synced repos update in real time." / "Your code, PRs, and agents are now in the same place."

It explicitly is **not** positioned as replacing GitHub when you don't want it to — GitHub-hosted repos can stay authoritative:

> "Pushes keep going to GitHub, which stays the source of truth" (for GitHub-synced repos).

It has a CLI for clone/push and a URL scheme (`cursor.com/codebase/[name]`), and an app-ecosystem play (Vercel, Depot, Buildkite integrations):

> "We're building an app ecosystem so your whole stack works seamlessly with Origin."

### Under the hood: "Continuity" (from the *Git at any scale* post)

Origin's storage engine is called **Continuity ("Cnt")**. Key technical points, all direct quotes:

- Problem framing (why agents make this worse): "Agents have fundamentally changed the way we work with software, and in many ways they've made this situation worse. More code, more PRs, more CI runs."
- It deliberately **keeps a real Git repo as the local unit**, same approach as GitHub's Spokes: "The local copy of the repository is, of course, a normal Git repository stored on a very fast NVMe drive. We do the same thing that Spokes does because I think Spokes got that exactly right."
- Durability model: writes go through a write-ahead log in S3-compatible object storage first — "We never acknowledge a push until it has been fully persisted," which "forces all pushes to be linearizable."
- Any node can be primary; consistency is via atomic CAS on S3 for the WAL.
- Throughput claims: up to 120 pushes/sec on S3 Standard, 300+ on S3 Express.
- **Git-level provenance (not conversation-level):** "Since every push is in the WAL, we can look at every state a repository has ever been in. We have full provenance data for all pushes, and also for all repacks." — this is provenance of *repository state transitions* (who pushed what, when), not a record of the agent conversation/prompts that produced a given commit.

### Does it store agent conversations / prompts?

Based on both fetched pages: **no explicit mention.** Origin's described feature set is repos, PRs, code browsing, GitHub sync, CI/deploy app integrations, and in-place agent Q&A/edits on hosted code ("Ask Cursor questions about code you're browsing. It can answer, make changes, update PRs, or push a branch."). There's no documented mechanism for snapshotting the *conversation* that led to a commit the way Delta's DeltaDB does. So: **"Cursor Origin" ≠ a Delta-style conversation/provenance layer.** It's closer to "GitHub, but Cursor-hosted and built for agent-scale push volume," with ordinary Git-commit-level audit trail (via the WAL) as its only provenance story.

If the user meant something else by "Cursor's Origin" (e.g., Cursor's agent-conversation history / checkpoints inside the editor, or session recall), I found no product by that name for that concept — Cursor's session/checkpoint history feature is just called "Checkpoints" / chat history in the editor, unrelated to "Origin."

---

## 3. Prior art for "provenance of AI-generated code"

| # | What | 1–2 lines | URL |
|---|------|-----------|-----|
| 1 | **GitHub Copilot coding agent — session logs linked from commits** | Each commit created by the coding agent embeds a link back to its session log, and commits are authored by Copilot with the requesting human listed as co-author: *"Each commit message includes a link to the session logs, so you can trace why a change was made during code review or an audit."* / *"Commits from Copilot cloud agent are authored by Copilot, with the person who started the task listed as co-author."* | [docs.github.com/.../coding-agent/track-copilot-sessions](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/track-copilot-sessions) |
| 2 | **Claude Code — session transcripts + PR linking + `--resume`/`--from-pr`** | Sessions are saved locally as JSONL under `~/.claude/projects/` (30-day default retention, plaintext); when a PR is created via `gh pr create`, *"the session is automatically linked to that PR"* and can be recovered later with `claude --from-pr 1234` or by pasting the PR URL into the resume picker. Commits Claude Code creates also carry a `Co-Authored-By:` trailer plus a `Claude-Session:` URL trailer (as configured in this very environment's git-commit instructions) — i.e. a session-URL-as-git-trailer pattern already exists in the wild. | [code.claude.com/docs/en/data-usage](https://code.claude.com/docs/en/data-usage), [code.claude.com/docs/en/common-workflows](https://code.claude.com/docs/en/common-workflows) |
| 3 | **Sourcegraph Amp — `Amp-Thread` git trailer + threads as durable, linkable objects** | Amp treats each agent conversation as a persistent "thread" addressable by URL (`https://ampcode.com/threads/T-...`) that can be referenced from other threads, forked, handed off, and — critically — Amp can be configured to *"Enable adding Amp-Thread trailer in git commits,"* directly embedding the thread URL in commit metadata. This is the closest off-the-shelf existing implementation of "commit ↔ conversation" linking via a git trailer. | [ampcode.com/manual](https://ampcode.com/manual), [ampcode.com/news](https://ampcode.com/news) (e.g. `/news/thread-map`, `/news/read-threads`, `/news/from-agent-to-agent`) |
| 4 | **Sourcegraph — "Compliance-first AI: proving agent provenance for regulated engineering teams"** | Proposes a retrieval-as-evidence audit model: log exactly which files/context an agent consulted and why, and make full conversations exportable (e.g. as PDF) as the audit artifact itself — *"every conversation exports as a PDF you can hand to an auditor instead of asking them to take the agent's word for it."* Useful counterpoint to trailer-based linking: export-the-transcript-as-the-record, rather than just a pointer. | [sourcegraph.com/blog/compliance-first-ai-proving-agent-provenance](https://sourcegraph.com/blog/compliance-first-ai-proving-agent-provenance) |
| 5 | **`git notes`** | Native Git mechanism for attaching arbitrary metadata (text or binary) to a commit *without changing its hash*, stored in a separate ref (`refs/notes/commits`) — a natural place to attach a transcript pointer, run_id, or review-finding summary to a commit after the fact, including retroactively. | [git-scm.com/docs/git-notes](https://git-scm.com/docs/git-notes) |
| 6 | **Jujutsu (jj)** | Git-compatible VCS with a fundamentally different data model: the working copy is itself always a commit (no staging-area split), and a single **operation log** records every atomic change to *all* refs at once (not per-branch reflogs), enabling full-repo undo/history of *operations*, not just content. Directly relevant as a model for "log every state transition, not just the final diff." | [docs.jj-vcs.dev](http://docs.jj-vcs.dev/latest/), [git-comparison](http://docs.jj-vcs.dev/latest/git-comparison/) |
| 7 | **Sapling (Meta)** | Meta's Git-compatible SCM, *"A Scalable, User-Friendly Source Control System,"* built around stacked commits and Commit Cloud (which backs up and syncs every draft commit off a single machine) — relevant as prior art for "never lose in-progress/undrafted work," a lighter version of the same instinct behind Delta. | [sapling-scm.com](https://sapling-scm.com/) |
| 8 | **Pijul** | Patch-based (not snapshot-based) VCS, grounded in a formal "theory of patches" where independent changes commute — a reminder that Git's snapshot model isn't the only possible substrate, and that a purpose-built replacement (rather than a layer on top) is a real design space Delta chose not to occupy. | [pijul.org](https://pijul.org/) |
| 9 | **SLSA (Supply-chain Levels for Software Artifacts)** | Industry framework for build/artifact provenance attestations (who/what/how built an artifact) — not AI-specific, and neither the SLSA site content fetched nor CycloneDX's docs currently define an AI-conversation-aware provenance attestation. Useful as the *shape* of an attestation format (signed statement: subject artifact + builder + materials) that a `run_id`-based scheme could emit, but there is no ready-made "AI-BOM" standard to adopt as-is — this is a gap, not a solved problem. | [slsa.dev](https://slsa.dev/) |
| 10 | **CycloneDX ML-BOM** | Existing "ML-BOM" standard covers model/dataset provenance and transparency (training data, framework, bias/security risk) — *not* "this code was produced by this agent conversation." Confirms there's no widely adopted "AI-generated-code-BOM" standard yet; if the factory wants a portable attestation format later, ML-BOM's structure (and CycloneDX's general BOM extensibility) is the nearest existing schema to extend from. | [cyclonedx.org/capabilities/mlbom](https://cyclonedx.org/capabilities/mlbom/) |
| 11 | **OpenSpec — "spec-anchored" delta specs** | Spec-driven-development tool for AI coding agents: each unit of work gets a `changes/<name>/` folder bundling `proposal.md` (why/scope), `specs/` (plain-Markdown requirements + scenarios), `design.md`, and `tasks.md`, versioned alongside the code instead of living only in chat history — *"AI coding assistants are powerful but unpredictable when requirements live only in chat history. OpenSpec adds a lightweight spec layer so you agree on what to build before any code is written."* Directly matches the factory's "design version" concept. | [github.com/Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) |
| 12 | **Devin (Cognition) — session-to-PR linking** | Widely reported/observed behavior: Devin PRs include a link back to the Devin session that produced them. I could **not** verify this with a fetched doc/blog quote in this pass (hit 404s on `docs.devin.ai` guides and the `cognition.com/blog/devin-2` launch post doesn't mention it) — flagging as **unconfirmed**, not to be cited as fact without a follow-up check. | [docs.devin.ai](https://docs.devin.ai) (unverified), [cognition.com/blog/devin-2](https://cognition.com/blog/devin-2) (checked, no mention found) |

### Notable gap observed
Across everything fetched, **no product or standard treats "conversation" as a first-class, content-addressed, versioned object the way Git treats trees/blobs/commits** except Delta/DeltaDB (private beta, no public API) and, more loosely, Amp threads (which are a product feature, not a portable data format). Everyone else's answer is "put a pointer (URL or trailer) from the commit to a conversation log stored somewhere else" — which is exactly the pragmatic pattern to copy for a self-built factory (see §4).

---

## 4. Recommendation: a concrete linking scheme for the factory

Given the current landscape, **do not wait for or build a Delta-equivalent.** Every mature player (Copilot, Claude Code, Amp) converges on the same pragmatic pattern: **keep Git as the artifact ledger; keep everything else (transcripts, designs, run metadata, review findings) in your own database; connect the two with a small number of stable, greppable identifiers.** This is strictly less ambitious than DeltaDB's continuous replication, but it's buildable today, works with plain `git log`, and doesn't require you to adopt someone else's closed-beta product.

### Minimal linking scheme

Introduce one canonical identifier — **`run_id`** (a ULID/UUID assigned when the pipeline kicks off an agent run against a ticket) — and thread it through every layer:

1. **Ticket → Design version**: Postgres `designs` table, `design.ticket_id`, `design.version`, `design.id`. Design docs can literally *be* OpenSpec-style `changes/<slug>/{proposal,specs,design,tasks}.md` committed into the repo (or a `.factory/` dir — see below) so the design is diffable and reviewable in the same PR as the code, not just a DB row.
2. **Design version → Conversation**: `runs` table row: `run.id (=run_id)`, `run.design_version_id`, `run.ticket_id`, `run.transcript_uri` (pointer to full transcript stored in DB/object storage — same idea as Claude Code's `~/.claude/projects/*.jsonl` or Amp's thread store), plus the *compiled* prompt actually sent (not just the template) for reproducibility.
3. **Conversation → Commit**: every commit the agent makes gets a **git trailer**, following the Copilot/Amp/Claude Code precedent exactly:
   ```
   Run-Id: 01J...ULID...
   Ticket-Id: ENG-1234
   Design-Version: 3
   Co-Authored-By: <agent-name> <agent@yourfactory.internal>
   ```
   This is the single highest-leverage move: `git log --grep` / `git show -s --format=%(trailers:key=Run-Id)` becomes your join key from Git into Postgres with zero extra tooling, forever, even if you change ticket systems.
4. **Commit → Run events / review findings**: `run_events` table keyed by `run_id` (tool calls, file edits, test runs) and `review_findings` table keyed by `run_id` + `commit_sha` (from code-review agents). A `git notes --ref=factory` entry per commit can mirror a short summary + link back into the DB, so the data survives even if someone clones the repo without DB access — `git notes` are the right mechanism per §3 item 5 (doesn't touch commit hashes, arbitrary payload, retroactively attachable).
5. **PR body backlink**: the PR description gets an auto-generated block linking `Run: https://factory.internal/runs/{run_id}` · `Ticket: {ticket_id}` · `Design: {design_version}` — same pattern as Claude Code's `--from-pr` / Amp's thread URL, giving humans a one-click path from GitHub back into your observability UI without needing the trailer parsed.
6. **A `.factory/` directory in-repo** (optional but cheap): store the *rendered* design doc and a manifest (`{run_id, ticket_id, model, tool_versions, started_at}`) as committed files alongside the code they produced, mirroring OpenSpec's `changes/` convention — this makes the "what produced this" story survive independent of your DB's uptime, and it's diffable/reviewable in the PR itself.

### Where Delta could plug in later

If/when DeltaDB ships a public API (it doesn't yet — private beta, no documented SDK), the natural integration point is step 2/3 above: instead of your own Postgres `transcript_uri` blob store, DeltaDB would *be* the transcript store, and your `run_id` trailer would point at a DeltaDB thread URL instead of an internal one — structurally the same scheme, just swapping the storage backend. Nothing about the recommended scheme needs to change to accommodate that later; it's designed to be storage-agnostic on the "where do transcripts live" question and only commit to the *linking* mechanism (trailers + `run_id` + PR backlink), which is the part that's actually hard to retrofit.

### Why not build a bespoke VCS

Jujutsu/Pijul-style "replace Git's data model" is a multi-year investment for marginal benefit here — your actual requirement ("never lose the conversation that produced a commit, and make it one click away") is fully satisfied by trailers + a DB + git notes, which is what every shipping product in §3 actually does, DeltaDB being the one interesting exception (and it's not consumable yet).
