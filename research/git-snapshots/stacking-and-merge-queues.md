# Stacking tools, merge queues, and off-GitHub CI runners

- **URLs:** Graphite https://graphite.com/docs ; git-spice https://abhinav.github.io/git-spice/ ; git-branchless https://github.com/arxanas/git-branchless ; GitHub stacked PRs https://github.blog/changelog/2026-07-30-stacked-pull-requests-are-now-in-public-preview/ ; GitHub merge queue https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue ; Mergify https://mergify.com ; Depot https://depot.dev/docs/github-actions/overview ; Buildkite https://buildkite.com/docs/pipelines/tutorials/github-merge-queue
- **Type:** workflow + integration layer
- **Researched:** 2026-08-26
- **Status/maturity:** Graphite: SaaS, acquired by Cursor (Dec 2025), Hobby free / Starter $20 / Team $40 (merge queue on Team). git-spice: GPL-3.0, 750 stars, v0.31.2 (2026-07-21), active. git-branchless: Apache/MIT, 4.1k stars, v0.11.1 (2026-05), "alpha". GitHub stacked PRs: public preview 2026-07-30, `gh extension install github/gh-stack`. GitHub merge queue: GA. Mergify: SaaS. Depot: SaaS runners (org repos only, $20/mo + $0.004/min). Buildkite: hosted agents + merge-queue integration (2025-10).

## One-paragraph summary

A factory producing dozens of agent PRs/day needs (a) small dependent PRs that re-base automatically when a lower one changes (stacking), (b) a serial gate that tests each PR against the *actual* future `main` before merging (merge queue), and (c) CI capacity that doesn't choke when 30 PRs enqueue at once (fast/batched runners). In 2026 GitHub covers (a) and (b) natively for free (stacked PRs preview + merge queue), OSS `git-spice` gives (a) with a scriptable CLI and multi-forge support, Graphite gives the polished version of (a)+(b) as SaaS, and Mergify/Buildkite/Depot address (c) with batching, bisect-on-failure, and faster runners.

## Core ideas / thesis

- Stacks: each PR's base is the previous PR's branch; tools store the parent graph locally (Graphite: `refs/branch-metadata/*`; git-spice: `refs/spice/data`; git-branchless: event log + hooks; gh-stack: server-side stack object) and rewrite all descendants when a parent changes ("restack").
- Merge queue: temporary `gh-readonly-queue/<base>/pr-N-<sha>` branches, `merge_group` webhook/event triggers CI, FIFO with grouping (min/max group size, wait time), failing PR is ejected, rest continue.
- Batching + bisection (Mergify) turns N queued PRs into ~log N CI runs; two-step CI (light on PR, full in queue).

## Architecture & mechanics

### Graphite `gt`
```
gt create -am "feat: x"        # new stacked branch + commit
gt modify -a                   # amend current, auto-restack children
gt restack                     # rebase descendants; -d downstack, -o only
gt submit --stack --no-interactive [--draft|--publish] [--ai]
gt sync -d                     # fetch trunk, delete merged, restack
gt get <branch> ; gt checkout ; gt log ; gt undo ; gt absorb ; gt track/untrack
gt auth -t <token>             # needed for PR creation
```
Metadata in `refs/branch-metadata/<branch>` (blob JSON: parent, prInfo). Merge queue (Team plan) merges whole stacks in dependency order, rebases in queue, "Graphite Agent" reviewer. Vendor risk: Cursor-owned; roadmap now tied to Cursor background agents.

### git-spice `gs`
```
gs repo init --trunk main --remote origin
gs branch create feat-x -m "..."      # --below / --insert to reposition
gs branch submit --fill --no-prompt --draft
gs stack submit --fill --no-prompt    # or upstack/downstack submit
gs repo sync                          # pull trunk, delete merged, restack
gs stack restack ; gs branch squash|fold|split|delete ; gs log long
gs stack merge   # experimental, merges stack into trunk in order
```
Global `--no-prompt` / `--prompt=false`, `-n` dry-run. State in `refs/spice/data` (pushable if you want). Forges: GitHub, GitLab, Bitbucket, Gitea/Forgejo. Best OSS fit for scripting.

### git-branchless
`git branchless init` installs hooks; `git sl` smartlog, `git undo` (event-log based, beyond reflog), `git move -s <commit> -d <dest>`, `git restack`, `git sync`, `git submit` (forge plugins: GitHub via `git submit --create`). Commit-oriented (not branch-oriented) stacking; alpha; good `undo` model but overlaps with jj's op log. Skip unless we stay pure-git and want undo.

### GitHub stacked PRs (preview) — `gh stack`
```
gh extension install github/gh-stack
gh stack init -b main            # start stack on current branch
gh stack add feat-2 -A -m "..."  # new layer (commit all)
gh stack submit --auto --remote origin   # open PRs for each layer
gh stack sync --prune ; gh stack rebase --upstack --continue|--abort
gh stack merge --squash -y       # merges this PR and every unmerged layer below it in one op
gh stack view --json ; gh stack link ; gh stack unstack ; gh stack up/down/top/bottom/trunk
```
Exit codes 0-10 (4 = API failure, stack locks). Server-side stack object; branch protection + required checks apply per layer; after full merge, `submit` starts a new stack from trunk. No GraphQL docs yet; merge-queue interaction undocumented.

### GitHub merge queue
- Enable via branch ruleset "Require merge queue"; settings: merge method (merge/squash/rebase), build concurrency 1-100, min/max group size 1-100, wait time, status-check timeout, "require all queue entries pass" vs "only last".
- CI must run on `merge_group`:
  ```yaml
  on:
    pull_request:
    merge_group:
      types: [checks_requested]
  ```
  External CI listens for pushes to `gh-readonly-queue/<base>/*`.
- Enqueue: web "Merge when ready", `gh pr merge --auto --squash <pr>`, GraphQL `enqueuePullRequest(input:{pullRequestId, jump, expectedHeadOid})` / `dequeuePullRequest(input:{id})`; `jump` rebuilds all in-progress groups (avoid).
- Failure: PR removed from queue, later entries rebuilt without it; no batching/bisection, no priority lanes, no analytics.

### Mergify (SaaS, GitHub App)
YAML `queue_rules` with `batch_size`, `speculative_checks`, `batch_max_wait_time`, bisect-on-failure, per-scope parallel queues (monorepo paths), two-step CI, priority, `queue_dequeue_reason` events (hookable for a repair agent). Their 2026 "State of Merge Queues" (153k merges/160 teams) claims agent-written PRs broke main ~half as often as human ones but bursts choke GitHub's per-PR queue.

### Off-GitHub runners
- **Depot**: `runs-on: depot-ubuntu-24.04` (org-owned repos only); claims up to 3x faster + 10x faster cache; $20/mo Developer incl. 2,000 min, $0.004/min after, per-second billing; can run in your AWS. Works with merge queue because it is just an Actions runner (merge_group jobs schedule like any other). Also sells "Depot Sandboxes"? — not found in docs; gap.
- **Buildkite hosted agents**: Linux/mac, per-vCPU-second billing, NVMe cache, git mirrors; explicit GitHub merge-queue integration (opt-in to `merge_group` webhooks; builds tagged as merge-queue builds; docs tutorial). Dynamic pipelines let a step spawn steps — useful for "one job per agent PR" fan-out. Free tier: not confirmed (gap).
- exe.dev's "replace your CI" post (already in queue) argues the merge queue *is* the CI for a factory: nothing runs on push, everything runs once in the queue.

## Workflow: end to end (agent PR → main)

1. Agent VM finishes; orchestrator pushes `agent/<task>` (single PR) or a `gs stack submit --fill --no-prompt` stack (multi-step task); PR body carries `Agent-Session:`/`Agent-Model:`/`Agent-Task:` trailers (copied into squash message via PR template).
2. Reviewer bot(s) + light CI on `pull_request`.
3. Human or policy approves → `gh pr merge --auto --squash` enqueues.
4. Queue builds `gh-readonly-queue/main/...`; full CI on `merge_group` (Depot/Buildkite runners).
5. Fail → PR dequeued → webhook (`pull_request.dequeued` / Mergify `queue_dequeue_reason`) → orchestrator resumes the *same* pi session in the same VM with the failure log → force-push → re-enqueue. Cap retries (3) then park in "Needs You".
6. Merged → stack tools `sync`/`gs repo sync` for dependent PRs; VM + branch TTL sweep.

## Notable techniques worth stealing

- `gs stack submit --fill --no-prompt` = fully scriptable stacked-PR creation from commit messages; `refs/spice/data` can be pushed so another VM can `gs repo sync` the same stack.
- `gh stack merge` "lands every unmerged layer below it in one operation" — removes rebase cascades; native, free.
- Merge-queue-as-CI (exe.dev) + Mergify batching/bisection for throughput.
- `dequeued` event → auto-repair agent loop (Untrivial AO does this in-app).
- Two-step CI: cheap on PR, expensive in queue — cuts cost when agents push often.
- Squash-merge with a PR-body template so provenance trailers survive the queue's rewrite (change IDs and per-commit trailers do not).

## Weaknesses / open questions / risks

- GitHub stacked PRs are preview: no API, unknown merge-queue behavior, exit-code "stack lock" semantics.
- Graphite lock-in now doubled by Cursor ownership; `gt` metadata format is theirs.
- GitHub merge queue is FIFO/no batching; with >~20 PRs/hour it serializes on CI time → Mergify or larger runners.
- Stacks from many *independent* agents are the wrong shape; stacks are per-task. Cross-task dependencies should be issues, not stack edges.
- Depot requires org-owned repo; solo dev must create an org.
- Off-GitHub CI still needs a GitHub App with `merge_group` permission; cost of two CI systems.

## Fit for our agentic stack (pi, one VM per agent)

- **Adopt:** GitHub merge queue (free, native) with `merge_group` CI; `gh pr merge --auto` from the orchestrator; per-task stacks via **git-spice** (`--no-prompt`, OSS, also GitLab) — or `gh stack` once it has an API; PR-template trailers for provenance; dequeue→repair loop resuming the same pi session.
- **Adapt:** run `gs`/`gh stack` *from the orchestrator*, not the model (same rule as jj: agents commit, orchestrators reshape history).
- **Later / if throughput demands:** Mergify batching, Depot or Buildkite runners; Buildkite dynamic pipelines if CI itself becomes agent-driven.
- **Skip:** Graphite (SaaS + Cursor), git-branchless (undo is covered by jj), Depot/Buildkite until queue latency is the bottleneck.

## Related resources mentioned

- https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands , https://docs.github.com/en/pull-requests/get-started/stacked-prs-quickstart
- https://mergify.com/blog/when-to-outgrow-github-merge-queue , https://mergify.com/compare/github-merge-queue , State of Merge Queues 2026 report
- https://buildkite.com/docs/pipelines/tutorials/github-merge-queue , https://buildkite.com/resources/changelog/310-github-merge-queue-integration/
- https://boinkor.net/2023/11/neat-github-actions-patterns-for-github-merge-queues/ — patterns for `merge_group` workflows
- https://graphite.com/blog/graphite-joins-cursor , https://graphite.com/blog/introducing-graphite-agent-and-pricing
- https://olivernguyen.io/w/jj.git/ — stacked PRs with jj (alternative to gs when using jj)
