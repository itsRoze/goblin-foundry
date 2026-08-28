# exe.dev "software factory" blog series + open-source pieces (exeuntu, exe.dev repo)

- **URL:** https://blog.exe.dev/ (RSS: https://blog.exe.dev/rss.xml) — repos: https://github.com/boldsoftware/exeuntu , https://github.com/boldsoftware/exe.dev
- **Type:** blog (series) + repo
- **Author/Org:** Bold Software / exe.dev — posts by Philip Zeyliger, Josh Bleecher Snyder, David Crawshaw, Danny Krause, and others
- **Researched:** 2026-08-26 (round 2; complements `exe-dev.md` from round 1 which covers the product/pricing — not repeated here)
- **Status/maturity:** Blog: 45 posts since 2025-12-15, several per week through 2026-08-20. `exeuntu`: 91 stars, last push 2026-08-22, Apache-2.0 (LICENSE file; GitHub reports NOASSERTION), weekly cron rebuild published to `ghcr.io/boldsoftware/exeuntu`. `exe.dev` repo: 146 stars, last push 2026-08-21, no license detected by GitHub (subdirs like `exe-scroll/` carry their own LICENSE); it is the "public issue tracker and open source repo" and a subtree mirror (`oss/`) synced out of their private monorepo *by the merge queue*.

## One-paragraph summary

Between Feb and Aug 2026 the exe.dev team published a loose "software factory" series describing how a ~7-person company actually runs an agent-heavy engineering org: replace post-merge CI with a pre-merge merge queue that runs *every* test and give agents a "merge queue minus the merge" command; have the human review the *agent's review* rather than the code ("Review the Reviews"), with numbered comments so the human can steer with "3: please fix / 2b: stet"; keep an inventory of ~10 named, single-purpose bots (Sisyphus for alerts, Athena for deploy babysitting, a security scanner, flaky-test fixer, log-trend emailer, daily Slack reporters, self-healing paragraph-described UI tests) each of which is "just 11 lines of code" (the sketch.dev agent loop) with deliberately limited tools; and never hand agents long-lived secrets — inject them at an HTTP proxy (`*.int.exe.xyz`) or mint short-lived credentials via OIDC token exchange / Workload Identity Federation ("OAuth for Agents"). The through-line ("Everyone Is Building a Software Factory") is that there is no one workflow — "7 people. 9 workflows." — and the enabling primitive is cheap, disposable, shareable VMs. The open-source pieces are the `exeuntu` image (Ubuntu 24.04 + systemd + Docker + `claude`/`codex`/`opencode`/`pi` installed by a Go `exeuntu update` helper, with a pi extension that routes to exe's LLM gateway) and the `exe.dev` repo (an agent `SKILL.md`, offline `exe0` token minting recipe, `sshminisig`, a Flue sandbox connector, `exe-scroll` terminal multiplexer, `completeinit` linter).

## Core ideas / thesis

1. **No single workflow; the VM is the primitive.** "It is unwise, right now, to declare The Solution and enforce it. Developer Productivity teams that are pushing a workflow on their users are being counterproductive." … "The only common denominator? We're all using VMs to isolate, try, share, iterate, parallelize. So many VMs." (*Everyone Is Building a Software Factory*, 2026-03-27, slug `/bones-of-the-software-factory`)
2. **CI is for humans; agents need a merge queue.** "agents are always new to a codebase" and "the agent context window is dead and gone by the time the poor human driving it is stuck with an automated email saying they broke CI." (*Replace Your CI With a Merge Queue*, 2026-06-07)
3. **Review the reviews.** Don't read the code; read an agent's numbered review of the code, direct fixes by number, iterate until reviews converge, then skim the final commit. (*Review the Reviews*, 2026-02-15)
4. **Bots are programs, many and small.** Named, narrowly-tooled agents; "an agent is just 11 lines of code"; respect the Lethal Trifecta; Botiquette rules (bots don't post to human spaces, always link to where they run and their source). (*Inventory*, 2026-08-06; *Botiquette*, 2026-08-05)
5. **Secrets belong in the proxy / identity, not the VM.** "What grants your server, and your agents, the ability to use the secret is their ability to reach your secrets HTTP proxy." (*Some Secret Management Belongs in Your HTTP Proxy*, 2026-04-18) and "give the agent an identity and let it obtain narrowly scoped, short-lived access when it needs it." (*OAuth for Agents*, 2026-08-11)
6. **Vibe-engineering, not vibe-coding**: run multiple concurrent agent builds of the same design, diff the *decisions* they made, codify into a terse "scar-tissue document" that guides the keeper build. (*Claude Is Not a Compiler*, 2026-07-21)
7. **Ask for the design after the build** — "a plan that's been prototyped is a better plan." (*No Plan Survives Contact With the Enemy*, 2026-08-14)

## Blog index (2026 posts relevant to agents / factory / merge queues / Shelley)

| Date | Title | Slug | Relevance |
|---|---|---|---|
| 2026-08-20 | We Taught sqlc to Invalidate Our Caches | /we-taught-sqlc-to-invalidate-our-caches | eng, not agents |
| 2026-08-18 | Have an Agent Babysit Your Deployments | /athena-deploys-exe | **Athena** deploy-supervisor agent |
| 2026-08-14 | No Plan Survives Contact With the Enemy (Reality) | /planning | planners vs iterators; "build your own software factory" |
| 2026-08-11 | OAuth for Agents | /oauth-for-agents | **WIF / OIDC token exchange** |
| 2026-08-06 | The End of No Code | /the-end-of-no-code | agents replace no-code tools |
| 2026-08-06 | A Non-Exhaustive Inventory of exe's Software Factory | /inventory | **agent inventory, 11-line agents** |
| 2026-08-05 | Simpler GitHub Integration URLs, Plus Read-Only Access | /github-integration-improvements | GitHub proxy integration |
| 2026-08-05 | Botiquette | /botiquette | **bot norms** |
| 2026-08-04 | Ghostty in the Machine: The Saga of exe-scroll | /exe-scroll | OSS terminal multiplexer |
| 2026-08-02 | Devtools must be open source | /devtools-must-be-open-source | why exeuntu/skill/etc. are OSS |
| 2026-07-22 | Customizing Shelley, Customizing Software | /customizing-shelley | Shelley |
| 2026-07-22 | How Antithesis Turned exe into a Sandbox for Agentic Software Tests | /how-antithesis-turned-exe-into-a-sandbox-for-agentic-software-tests | **customer story, VMs spawning VMs** |
| 2026-07-22 | Run a Slack Bot from Your VM (Without Giving It the Keys) | /run-a-slack-bot-from-your-vm-without-giving-it-the-keys | **secret-free Slack integration** |
| 2026-07-21 | Claude Is Not a Compiler | /claude-is-not-a-compiler | **vibe-engineering method** |
| 2026-07-06 | Building Software From My Phone | /building-software-from-your-phone | mobile agent driving |
| 2026-07-03 | Connect Your ChatGPT Subscription to exe.dev | /chatgpt-subscription | LLM integration |
| 2026-06-07 | Replace Your CI With a Merge Queue | /replace-your-ci | **merge queue** |
| 2026-05-04 | Dev, Test, Prod: Choose One, Two, or Three | /dev-test-prod | VM-per-env patterns, "Edit with Shelley" ribbon |
| 2026-04-18 | Some Secret Management Belongs in Your HTTP Proxy | /http-proxy-secrets | **secret-injection proxy** |
| 2026-03-31 | Prompt Engineering Is Dead, but Claude Still Tries | /prompt-engineering-is-dead | prompting |
| 2026-03-27 | Everyone Is Building a Software Factory | /bones-of-the-software-factory | **thesis post** |
| 2026-03-05 | APIs for the RESTless | /apis-for-the-restless | SSH-as-API, exe0 tokens |
| 2026-03-03 | Why exe.dev VMs Are Persistent | /persistent | persistence rationale |
| 2026-02-22 | Show, Don't Tell | /show-dont-tell | demos > PRs |
| 2026-02-15 | Review the Reviews | /review-the-reviews | **cascading review** |
| 2026-02-13 | Software as Wiki, Mutable Software | /software-as-wiki | end-user-editable software |
| 2026-02-03 | Expensively Quadratic: the LLM Agent Cost Curve | /expensively-quadratic | agent-loop cost math |
| 2026-01-27 | Your Codebase Is the Prompt | /codebase-as-prompt | codebase as context |
| 2026-01-22 | SSH Has No Host Header | /ssh-host-header | SSH routing |
| 2026-01-08 | Goodbye Sketch, Hello Shelley! | /shelley | Shelley intro |

(Also: Jan/Feb monthly updates, Series A, regions, iOS, sharing, tailmix, billing — product news, skipped.)

## Post-by-post summaries

### Everyone Is Building a Software Factory (2026-03-27, Philip Zeyliger; slug `/bones-of-the-software-factory`)

Short manifesto. Key claims, verbatim:

> "We are seeing a Cambrian explosion of workflows in how to produce software. It is unwise, right now, to declare The Solution and enforce it."

> "The key is the compute primitive. You–and everyone else on your team–need to have plentiful, performant, trivial-to-provision VMs that can be accessed from your phone or anywhere, that can be shared securely, that integrate nicely, and that can be trusted with your data. Given this, you'll find an explosion of agents, automations, UIs, workflows, notifications, bots, claws, and so on. The successful ones will evolve to be the bones of your software factory."

> "We went around the office recently, and talked through our workflows. 7 people. 9 workflows. (Not a joke!)"

Concrete workflows listed: a newsletter bot that visits Slack about support rotation; a Clickhouse-logs integration; "the background agent fighting the noble fight against test flakes"; multi-agent orchestrators; **an "inbox" view that gathers agent conversation state from all the VMs and sorts them by recency and annotates whether they've been pushed**; vanilla Claude Code; the pi coding agent; Shelley.

### Replace Your CI With a Merge Queue (2026-06-07)

Argument: CI (post-merge tests) works for humans because humans have long-term codebase knowledge and break HEAD rarely. Two reasons it fails for agents:

> "The first is that agents are always new to a codebase. They don't have all the implicit knowledge of the codebase expert, and so they regress parts of the project they have not paid attention to all the time."

> "The second problem is the agent context window is dead and gone by the time the poor human driving it is stuck with an automated email saying they broke CI. Your agent should have been quietly solving that problem before making it other people's problem. It has all the time in the world as long as it is not in anyone's way. Let the computer drive the computer."

**Merge queue design (their words):**
- "A merge queue is a script you run to push to origin/main (instead of using a PR UI like we did back in the GitHub, all-human days)."
- "It is very important you run all the tests in the merge queue. Do not have 'slow' tests you run daily. In the age of agents, those tests will be broken every day. … the only thing worse than cleaning up after someone else is cleaning up after someone else's robot."
- "After you have a merge queue that works, create a second command to run the merge queue, minus the actual merge. Give it to your agents."
- Guarantees: "The active context window can run the tests and fix the bugs before inflicting them on other people. No one, neither human nor machine, breaks the build."
- "tests must be fast to use agents." / "You will need expensive computers to power your merge queue. It is worth it."

Cross-reference from *Inventory*: the build queue is allowed to **modify the commit on its way through** (self-healing UI tests: "Yes, the build queue modifies the commit on its way through if necessary"). And from the `exedev-flue/README.md`: the merge queue also performs the `oss/` subtree mirror to the public GitHub repo.

### Review the Reviews (2026-02-15, Josh Bleecher Snyder; cross-posted at commaok.xyz/ai/review-the-reviews/)

Motivation: Simon Willison's "cognitive debt" ("I no longer have a firm mental model of what they can do and how they work"). Code reviews, not commit history, were the best "operational learning" feed on the Go project. So:

> "I ask an agent to do something. Code happens. I then ask an agent to review that code, without looking at it myself. Then I review the review."

> "The agent's review typically contains design commentary, questions about decisions made, bugs, and nits. This is usually enough for me to get a clear idea about what's going on in the code, at the right level of abstraction."

The heavily used code-review skill (quoted):

> "Number all comments, questions, and suggestions for easy reference. Use an ever-incrementing scheme starting at 1. Format: Top-level items: 1., 2., 3. Sub-items: 2a., 2b. This lets the user respond concisely and unambiguously: '3: please fix' or '2b: stet'"

Cascade: "An agent who has just done a code review has an ideally primed context window for working on that code. It makes fixes for me." Then "I amend the commit unseen and start another code review cycle. When the code reviews stabilize, I skim the final commit. There are rarely any surprises." Convergence criterion: reviews "converge on commentary I've already decided to ignore, places where the model weights and I flatly disagree." Prompt-history stats: top 2-gram "please codereview" (0.39%).

### A Non-Exhaustive Inventory of exe's Software Factory (2026-08-06, Philip Zeyliger)

The list (each is a separate bot/agent/system):
1. **Security scanner agent** — "Fable refuses to help out, so we systematically look for security issues, with a bias toward recent changes."
2. **Sisyphus** — alert investigator: "looks through our logs and metrics and source code, as well as analyzing its own previous investigations, to tease out what's going on."
3. **Log-trend agent** — daily email "with interesting trends in our logs."
4. **Flaky/slow-test bots** — "continuously analyzing flaky or slow tests in our CI and suggesting changes."
5. **status.exe.dev** — self-built, hosted off-platform.
6. **Paging via PushOver** (not PagerDuty; PushOver has Apple Emergency Alerts entitlement + "a lovely API").
7. **Athena** — deploy/rollout supervisor (see below).
8. **Blog CMS** with collaborative editing, revisions, comments, embargoes, content calendar; "A built-in agent (really, Shelley running on the same VM) can import a blog post from whatever you paste in."
9. **Self-healing paragraph UI tests**: "Shelley's UI tests are increasingly a paragraph of text asking for some behavior. There's a cache file (checked into git) that makes the test cheap and fast. When it fails, the CI system 'heals' it with an LLM, and either fails or checks in the new fixed test. Yes, the build queue modifies the commit on its way through if necessary."
10. **Reporter bots** — daily Slack summaries of git commits, help threads, etc.

Security caveat (verbatim): "if you're writing bots that read untrusted data, understand the Lethal Trifecta: private data, untrusted content, and external communication. We happen to think that exe.dev VMs are a great place to isolate these bots, but we also make sure that the tools available to these agentic loops (an agent is just 11 lines of code: https://sketch.dev/blog/agent-loop) are limited in what they can do."

The "11 lines" refers to the sketch.dev agent loop; *Expensively Quadratic* (2026-02-03) prints the same loop:

```python
def loop(llm):
    msg = user_input()
    while True:
        output, tool_calls = llm(msg)
        print("Agent: ", output)
        if tool_calls:
            msg = [handle_tool_call(tc) for tc in tool_calls]
        else:
            msg = user_input()
```

### Have an Agent Babysit Your Deployments (2026-08-18, Josh Bleecher Snyder)

Why an agent, not code: "This has exactly the right shape for an agent instead of code: Lots of rich data, a very long tail of possible states, relatively few runs (a handful a day, not 100qps)." Athena lives in "exe-ops", their "Deployment Command Center" ("We started with shell scripts, but then built a UI … we're building up from shell scripts into the exact shape we want"). Capabilities: "read access to git and metrics and logs. It decides at each stage: should we proceed? Which machines should be in the next wave? It can escalate to a human and it can pause a deployment—or refuse to start one, if it deems it unwise. It communicates by sending us Slack messages." Key line: "the important question is not 'in theory, could I do a better job?' but 'in reality, will I do a better job?'"

### Botiquette (2026-08-05)

Verbatim rules: "Bots do not post to human spaces." / "There is no expectation that other humans will read human posts to bot spaces." / "Humans write their own words." / "If a human pastes bot output into a post, that output is clearly marked as such." / "Bot posts always include where the bot is running and where its source code is." / "Bots have names … but they are computer programs. Their pronouns are always 'it/its'."

### Some Secret Management Belongs in Your HTTP Proxy (2026-04-18)

Problem framing: "Agents fuss when you directly hand them an API key. … some models (you know which ones) freak out on seeing the secret … Models that are not so ridiculous about API keys will write the key to inter-session memory." Deeper: "API keys are convenient but too powerful. Holding one does not just grant you the ability to make API calls, it grants you the power to give others the ability to make API calls." OAuth for machines "is always painfully complex" and "designed to have some human intervention via a web browser cookie."

**Mechanics:** most secrets are HTTP headers, so replace the host:

```sh
# before
curl https://api.stripe.com/v1/customers -u "sk_test_...:" -d "name=Jenny Rosen"
# after: proxy injects the Authorization header
curl https://stripe.int.exe.xyz/v1/customers -d "name=Jenny Rosen"
```

"What grants your server, and your agents, the ability to use the secret is their ability to reach your secrets HTTP proxy. This covers, amazingly, almost all secrets." Product mapping: "Assign an integration to a tag, tag the VMs you want to have access, done. Clone your VM, you get a fresh space to work with agents and your integrations are automatically present." GitHub is special: a GitHub App manages OAuth/rotation. Slack post (2026-07-22) shows the same pattern for chat: `curl --json '{"text":"..."}' https://<slack-integration-name>.int.exe.xyz/` and a full bot via `https://<slackbot-name>.int.exe.xyz/api/chat.postMessage` with both Slack tokens held off-VM ("that's true of all our integrations").

### OAuth for Agents (2026-08-11)

Thesis: "Giving an agent a long-lived secret means trusting not only the agent itself, but every tool it invokes, every file it reads, and every instruction it encounters, magnified by autonomous decision making." → "give the agent an identity and let it obtain narrowly scoped, short-lived access when it needs it." Lineage: Kubernetes → GCP Workload Identity (k8s API server as OIDC issuer), "a lesser-known OAuth 2.0 flow called token exchange", adopted by GitHub Actions.

**exe WIF flow (from the post's sequence diagram):** (1) agent in VM calls cloud SDK; (2) the SDK's external-account config points at the exe token endpoint; (3) the attached WIF integration "verif[ies] the VM is allowed to use this integration" and returns a short-lived exe.dev OIDC token; (4) the VM sends it directly to Google STS, which fetches exe.dev issuer metadata/JWKS if not cached and verifies signature/issuer/audience/expiry/subject; (5) STS returns a federated token; (6) IAM Credentials API checks impersonation permission and issues a short-lived service-account access token; (7) call BigQuery. Setup: create an "Identity Federation" integration, attach to tags/VMs, configure the cloud side (guides for AWS and GCP exist).

### How Antithesis Turned exe into a Sandbox for Agentic Software Tests (2026-07-22, customer story, Carl Sverre)

Local sandboxes "too limiting" ("As soon as the AI wants to do something out of that boundary, it gets blocked"); big platforms built for shipping AI products; "I just realized what I wanted was, like, a computer." Pricing: team $25/user/mo, up to 50 VMs from a pool — "I don't want to ever have to feel like I'm spending money when I create a sandbox." Workflow: "spin up an exe machine, check out the project, open up Claude, ask a bunch of questions, and then throw away the VM." Persistent variant: Snouty CLI developed on a persistent VM driven via Claude remote control from phone/browser. Security ask fulfilled in 2–3 days: restrict who can make a VM public. Differentiators: root access; no hibernation ("Every other VM platform on the planet hibernates your VMs … Exe is the only one that doesn't"). Future: "VMs that spin up other VMs and divide up work automatically."

### Claude Is Not a Compiler (2026-07-21) — vibe-engineering method

Concrete method used to build a geo-distributed consistent DNS server in ~1 week of attention: decide top-level architecture in person; use LLMs for research; "prompted multiple concurrent agent loops into building the entire thing, including tests and adversarial code review"; answer their questions and convert answers into "very terse written guidance"; "asked new agents to compare the completed implementations and look for interesting deviations. It was shocking how many important decisions the agents never asked about but simply made—and made differently"; repeat the "differential spec analysis" twice; build the keeper from the accumulated "scar-tissue document". "Claude and Codex both agreed that Claude created a more elegant system but that Codex was more thorough." Output included unit + e2e tests, shadow mode, "a terse written-by-and-for-agents doc suite."

### Dev, Test, Prod (2026-05-04)

Patterns: one VM for all three (blog/bot/dashboard; "Set up continuous deployment by asking Shelley to poll every hour"); internal tools carry an **"Edit with Shelley" ribbon** linking to `vm.shelley.exe.xyz` or `exe.dev/new` with pre-filled prompt+tags; dev via `cp` clones or setup scripts, worktrees per task; "Pull requests are so yesterday; send them a link to a working demo instead."; test VMs for flake-hunting, security review, or GitHub Actions runners.

## Factory practices extracted (with quotes)

| Practice | Mechanism | Quote / source |
|---|---|---|
| Merge queue replaces CI | Script pushes to origin/main after running *all* tests; agent gets a no-merge variant | "create a second command to run the merge queue, minus the actual merge. Give it to your agents." (/replace-your-ci) |
| Build queue may rewrite commits | Self-healing UI tests re-checked in by the queue | "the build queue modifies the commit on its way through if necessary" (/inventory) |
| Cascading review | Agent codes → agent reviews with numbered items → human answers by number → same agent fixes → repeat until convergence | "'3: please fix' or '2b: stet'" (/review-the-reviews) |
| Agent inventory | ~10 named single-purpose bots, each with restricted tools | "an agent is just 11 lines of code" (/inventory) |
| Botiquette | Bots stay out of human channels; posts link run location + source | (/botiquette) |
| Secret injection proxy | Swap API host for `<name>.int.exe.xyz`; proxy adds header; attach by tag; clones inherit | "This covers, amazingly, almost all secrets." (/http-proxy-secrets) |
| OAuth for agents | exe.dev is an OIDC issuer; VM identity → STS token exchange → short-lived SA token | "give the workload an identity, establish trust between systems, and mint short-lived access" (/oauth-for-agents) |
| Differential spec analysis | Multiple concurrent agent builds, diff decisions, codify | "It was shocking how many important decisions the agents never asked about but simply made" (/claude-is-not-a-compiler) |
| Agent inbox | UI aggregating agent conversation state from all VMs by recency + pushed flag | (/bones-of-the-software-factory) |
| Deploy babysitter | Agent with read-only git/metrics/logs gates waves, pauses, escalates via Slack | (/athena-deploys-exe) |

<!-- REPO SECTION APPENDED BELOW -->

### Other 2026 posts worth a line each

- **APIs for the RESTless (2026-03-05):** "Our CLI and our API are one and the same." Offline token minting with the `exetoken()` shell function (below, in the SKILL/token section). "Removing an SSH key from your exe.dev account revokes all tokens signed with that SSH key." VM-scoped tokens sign with namespace `v0@myvm.exe.xyz` and pass the VM's auth proxy directly (`curl -H "Authorization: Bearer $VM_TOKEN" https://myvm.exe.xyz/api/data`).
- **Expensively Quadratic (2026-02-03):** cost = tokens × number-of-calls; "By 50,000 tokens, your conversation's costs are probably being dominated by cache reads" (one $12.93 session: cache reads were half the cost at 27,500 tokens, 87% at the end; simulator says ~20k tokens at Opus rates). Advice: don't truncate large tool outputs ("it's going to read the whole file, and it may as well do it in one call rather than five"); use subagents/LLM-grep for iteration outside the main window; "the tokens spent on re-establishing context are very likely cheaper than the tokens spent on continuing the conversation."
- **Your Codebase Is the Prompt (2026-01-27):** "Agents mirror local style. Your codebase is the prompt. … don't correct the agent. Instead, improve the code it learned from." Their e2e suite is "deeply empiricist": tests only do/observe what a user or admin can.
- **Devtools must be open source (2026-08-02, Crawshaw):** two prompts make any OSS tool personalizable — "Download the source for <software> and build it for local use…" and "Set up a nightly cron job that executes the prompt: fetch upstream changes to the <software> and rebase all local changes on top of upstream." Built into Shelley as a skill; "This same skill-based technique … can be trivially applied to other open-source agents like Pi. (… I am left wondering why Pi needs an extension system built into it. The source code is the extension system.)" Claude Code being closed-source is called out as the wall. Also introduces **meat.dev** (LLM diff-minimizer for review) wired into Shelley to pre-process every commit in the background.
- **Customizing Shelley (2026-07-22):** ask Shelley to change itself; upgrades rebase your customizations onto the new version.
- **Software as Wiki (2026-02-13):** "Edit with Shelley" button on internal tools (slinky link shortener) → agent on the same VM one-shots the feature.
- **Show, Don't Tell (2026-02-22):** `exe.dev/new` + prompt → VM + Shelley from a phone; share links `https://<vm>.exe.xyz?share=TOKEN` with email verification.
- **GitHub integration improvements (2026-08-05):** any repo at `https://github.int.exe.xyz/OWNER/REPO` (integration auto-selected); read-only integrations for both git and API.
- **The End of No Code (2026-08-06):** "ask the agent to write an 'agentic loop using the exe.dev LLM integration' with tools to do this and that … The agent will one-shot it."
- **Why exe.dev VMs Are Persistent (2026-03-03):** no quiescing so cron/systemd timers work; agent can "write AND operate" the thing; they run their blog, link shortener, log-analysis DB+agent on exe VMs.

## Repos

### `boldsoftware/exeuntu` (Apache-2.0 per LICENSE; 91 stars; last commit 2026-08-21 "install GitHub CLI from release binary"; published as `ghcr.io/boldsoftware/exeuntu`)

Files: `Dockerfile`, `Makefile`, `init-wrapper.sh`, `exe-setup.service`, `shelley.service`/`shelley.socket`, `AGENTS.md`, `motd-snippet.bash`, `nginx.conf`, `index.html`, `opencode.json` + `opencode-plugin/`, `pi-extension/` (TypeScript), `cli/` (Go: `exeuntu` binary with `install|update <agent>` and `llm configure`), `tmpfiles-tmp.conf`, `xterm-ghostty.terminfo`.

**Dockerfile, read in full:**
- **Stages:** `chromedp/headless-shell:stable` (Chrome copied to `/headless-shell`, added to PATH for Shelley's browser tool); `golang:1.27.0` builds the static `exeuntu` helper (`-ldflags -X main.gitVersion=…`); final `FROM ubuntu:24.04`.
- **Philosophy:** "We believe that minimal containers make for terrible developer (and agent) experiences" — it *unminimizes* Ubuntu (restores docs/man pages, reinstalls all base packages), and runs `dist-upgrade` on every weekly no-cache cron rebuild (comment cites "nginx Rift, CVE-2026-42945").
- **Packages:** build-essential, git, curl, wget, jq, ripgrep, sqlite3, vim/neovim, python3-pip, pipx, **uv** (to `/usr/local/bin`), latest **Go** from go.dev, **gh** (pinned `GH_VERSION=2.97.0`, checksum-verified via `install-gh.sh`; "CI overrides GH_VERSION with the newest stable release older than five days"), **Tailscale**, **docker.io + buildx + compose-v2**, **mitmproxy**, **bubblewrap**, nginx (installed, disabled), openssh-server/client, socat, netcat, rsync, imagemagick, ffmpeg, atop/btop/iotop/ncdu, fonts (noto-color-emoji, symbola), X/GTK libs for Chrome, `systemd systemd-sysv`, `dbus-user-session`, `ubuntu-server ubuntu-dev-tools ubuntu-standard`. Removes `pollinate ubuntu-fan`. Deletes generated SSH host keys ("Do not bake those per-image private keys into exeuntu"). `setcap cap_net_raw=+ep /usr/bin/ping`.
- **systemd:** a long list of units masked/disabled (getty, udev, snapd, unattended-upgrades, apt timers, plymouth, resolved, logind disabled-not-masked, `ssh.socket`/`ssh.service` masked — **sshd is not run by the image; SSH to the VM is provided by exe.dev's proxy/agent path, not by in-image sshd**; there is no sshd_config customization at all). `system.conf.d/container-overrides.conf`: `LogTarget=console`, `SystemCallArchitectures=native`, `DefaultOOMPolicy=continue`; journald `Storage=persistent`; `set-default multi-user.target`. `/etc/fstab` = `/dev/vda / ext4 defaults,x-systemd.growfs 0 1` so root grows on first boot. `/etc/machine-id` emptied last so each VM gets its own. `CMD ["/usr/local/bin/init"]` = `init-wrapper.sh`, which requires PID 1, mounts cgroup2, sets `ip_unprivileged_port_start=0`, remounts `/proc/sys` rw ("Kata containers default to mounting this readonly"), then `exec /sbin/init`. (The Makefile's `docker run` needs `--cap-add=ALL --security-opt seccomp=unconfined --cgroupns private --tmpfs /run …`.)
- **Users:** the stock `ubuntu` (UID 1000) is renamed to **`exedev`**, home `/home/exedev`, in groups `sudo` and `docker`, `exedev ALL=(ALL) NOPASSWD:ALL`, `Defaults:exedev verifypw=any`, linger enabled (`/var/lib/systemd/linger/exedev`) so user services run; `XDG_RUNTIME_DIR=/run/user/$(id -u)` exported in `.bashrc`/`.profile`; `git config --global init.defaultBranch main`; Ubuntu MOTD replaced with a bash snippet that prints hostname, "The disk is persistent. You have 'sudo'." and a random hint (Shelley URL `https://<vm>.shelley.<suffix>/`, xterm URL `https://<vm>.xterm.<suffix>/`, port 4444 example). `LABEL exe.dev/login-user=exedev`, `LABEL exe.dev/install-shelley=true`, `EXPOSE 8000 9999`.
- **First-boot hook:** `exe-setup.service` — oneshot, `ConditionPathExists=/exe.dev/setup`, runs as `exedev`, `ExecStart=/bin/bash -c /exe.dev/setup`, then `sudo rm -f /exe.dev/setup` (this is where `ssh exe.dev new --setup-script` lands). The `/exe.dev/` directory is the marker the pi extension checks to know it is on an exe VM.
- **Shelley:** binary "installed at vm creation" (not in the image); `shelley.socket` listens `127.0.0.1:9999`, `shelley.service` runs `/usr/local/bin/shelley -debug -db ~/.config/shelley/shelley.db -config /exe.dev/shelley.json serve -systemd-activation -require-header X-Exedev-Userid` — i.e. Shelley trusts the identity header injected by exe's auth proxy and refuses requests without it.
- **Agent installs (how pi/claude/codex are versioned):** all via the Go `exeuntu` helper (`exeuntu install|update claude|codex|opencode|pi [--version X]`), not npm:
  - **claude:** downloads from `https://downloads.claude.ai/claude-code-releases` (manifest gives version + sha256; constant-time checksum compare) → `/usr/local/bin/claude`. Latest at build time unless `--version`.
  - **codex:** resolves tag from `https://github.com/openai/codex/releases/latest`, downloads `codex-package-<arch>.tar.gz`, verifies against `codex-package_SHA256SUMS`, unpacks to `/usr/local/lib/codex/<tag>-<arch>-<sha8>/`, symlink-activates `/usr/local/bin/codex`.
  - **opencode:** similar; `opencode.json` sets `"autoupdate": false` ("exeuntu owns the system binary"); a dependency-free OpenCode plugin `exe-dev.js` registers models from attached LLM integrations.
  - **pi:** `piupdate` reads latest from `https://registry.npmjs.org/@earendil-works/pi-coding-agent/latest`, downloads the **prebuilt binary tarball** `https://github.com/earendil-works/pi/releases/download/v<ver>/pi-linux-{x64,arm64}.tar.gz` (no Node/Bun runtime needed), extracts to `~/.local/pi/`, verifies `pi --version`, symlinks `~/.local/bin/pi`; Dockerfile runs it as `exedev` with optional `ARG PI_VERSION` and adds `/usr/local/bin/pi -> /home/exedev/.local/bin/pi`. Pre-seeds `~/.pi/agent/bin/fd` (latest sharkdp/fd release) "so pi doesn't try (and on a fresh VM, often fail with a GitHub API 403) to download it on first use."
  - Config dirs pre-created: `~/.claude`, `~/.codex`, `~/.pi`, `~/.config/opencode/{plugins,node_modules}`; one shared `AGENTS.md` at `~/.config/shelley/AGENTS.md` symlinked to `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.config/opencode/AGENTS.md`, `~/.pi/AGENTS.md`. Its content is three lines: "You are running in an exe.dev VM." + docs pointers + "Only use documented exe.dev features … Undocumented local endpoints are internal infrastructure—unstable and unsupported."
- **pi extension** (`~/.pi/agent/extensions/exe-dev/`, ~1.7k lines TS incl. tests): activates only if `/exe.dev` exists; fetches `https://reflection.int.exe.xyz/integrations` (1.5 s timeout) to discover attached LLM integrations and their model lists, `pi.registerProvider(id, config)` for each (bundled `catalog.json` from `https://exe.dev/llm-gateway-models.json` supplies pricing/compat only), rewrites request payloads for the gateway, asks once "Use exe.dev LLM integrations?" and stores the answer in `~/.pi/agent/exe-dev-llm-integration.json`, unregisters providers whose baseUrl points at exe routes when disabled, and injects a system-prompt line: "You are running inside an exe.dev VM, which provides HTTPS proxy, auth, email, and more. Docs index: https://exe.dev/docs.md". This is a concrete, tested example of a pi extension that adds a provider + system-prompt context.
- **`exeuntu llm configure claude|codex`** (Go `guestllm`): reads reflection, picks an LLM integration, writes `~/.claude/settings.json` with `env.ANTHROPIC_BASE_URL=<integration base URL>` or `~/.codex/config.toml` with a provider, tracking managed files by sha256 in `~/.config/exe/guest-llm-config.json` so it never clobbers user edits.

### `boldsoftware/exe.dev` (146 stars; last push 2026-08-21; public issue tracker + `oss/` subtree mirror of the private monorepo, synced *by their merge queue*)

Contents: `skill/SKILL.md`; `bin/` (`which_keys.sh`, `exe-ssh-config-generator`, `build-exe-scroll-darwin.sh`); `sshminisig/` (Go); `exe-ssh/` (Python, HTTPS/WebSocket terminal with persistent named sessions); `exedev-flue/` (TS sandbox connector for the Flue agent framework + Go handler); `exe-scroll/` (Zig dtach-like multiplexer using ghostty-vt for scrollback, MIT); `completeinit/` (Go linter, "entirely vibe-coded"); `nix/` (NixOS-userland image example via ttl.sh); `.github/workflows/test.yml` (tests every Go module and Python package, auto-tags modules `module/v0.<count>.9<octal-sha>`, builds/releases exe-scroll).

**`skill/SKILL.md` (near-verbatim; it is short):**

```
---
name: using-exe-dev
description: Guides working with exe.dev VMs. Use when the user mentions exe.dev, exe VMs, *.exe.xyz, or tasks involving exe.dev infrastructure.
---
# About
exe.dev provides Linux VMs with persistent disks, instant HTTPS, and built-in auth. All management is via SSH.
## Documentation
- Docs index: https://exe.dev/docs.md
- All docs in one page (big!): https://exe.dev/docs/all.md
The index is organized for progressive discovery: start there and follow links as needed.
## Quick reference
ssh exe.dev help             # show commands
ssh exe.dev help <command>   # show command details
ssh exe.dev new --json       # create VM
ssh exe.dev ls --json        # list VMs
ssh exe.dev rm <vm>          # delete VM
ssh <vm>.exe.xyz             # connect to VM
scp file.txt <vm>.exe.xyz:~/ # transfer file
Every VM gets `https://<vm>.exe.xyz/` with automatic TLS.
## A tale of two SSH destinations
- `ssh exe.dev <command>` — the exe.dev lobby. A REPL for VM lifecycle, sharing, and configuration. Does not support scp, sftp, or arbitrary shell commands.
- `ssh <vm>.exe.xyz` — a direct connection to a VM. Full SSH: shell, scp, sftp, port forwarding, everything.
## Working in non-interactive and sandboxed environments
scp/sftp failures: Ensure you're targeting `<vm>.exe.xyz` rather than `exe.dev`.
Hung connections: Non-interactive SSH can block on host key prompts with no visible output. Use `-o StrictHostKeyChecking=accept-new` on first connection to a new VM.
SSH config: Host exe.dev *.exe.xyz / IdentitiesOnly yes / IdentityFile ~/.ssh/id_ed25519
```

Commands it teaches: `help`, `help <cmd>`, `new --json`, `ls --json`, `rm`, plain `ssh <vm>.exe.xyz`, `scp`. **It does not mention `/exec` tokens at all** — the skill delegates everything else to `https://exe.dev/docs.md` (progressive disclosure). Token handling lives in the other pieces:

- **`exedev-flue/exedev.md`** (agent-readable install prompt, served at `https://exe.dev/flue/exedev.md`, "curl -fsSL https://exe.dev/flue/exedev.md | claude") teaches the offline mint recipe:
  ```sh
  ssh-keygen -t ed25519 -C api -f ~/.ssh/exe_dev_api
  cat ~/.ssh/exe_dev_api.pub | ssh exe.dev ssh-key add
  b64url() { tr -d '\n=' | tr '+/' '-_'; }
  PERMISSIONS='{"cmds":["new","rm","cp","ls","whoami"]}'
  PAYLOAD=$(printf '%s' "$PERMISSIONS" | base64 | b64url)
  SIG=$(printf '%s' "$PERMISSIONS" | ssh-keygen -Y sign -f ~/.ssh/exe_dev_api -n v0@exe.dev)
  SIGBLOB=$(echo "$SIG" | sed '1d;$d' | b64url)
  TOKEN="exe0.$PAYLOAD.$SIGBLOB"
  curl -X POST https://exe.dev/exec -H "Authorization: Bearer $TOKEN" -d 'whoami'
  ```
  with the rules "Default token `cmds` includes `new` but not `rm`/`cp` — override as above" and "**Never invent a token value. It must come from the user.**" The connector (`exedev.ts`, 883 lines) uses `POST https://exe.dev/exec` only for lifecycle (`new [name]`, `cp <source>`, `rm <name>`), then SSH+SFTP (`ssh2`) into `<vm>.exe.xyz` for commands/files; it polls up to 90 s for DNS + sshd readiness; modes `host` (existing), `cloneFrom` (ephemeral per-run off a golden VM — "Use when: Ephemeral per-run isolation off a pre-configured base"), `createVm` ("Rarely the right choice"); `cleanup: true` removes only auto-created VMs. Env convention: `EXE_VM_HOST`, `EXE_API_TOKEN` (`exe0.*`/`exe1.*`), `EXE_SSH_KEY`, `SSH_AUTH_SOCK`.
- **`exe-ssh/cli.py`** mints short-lived `exe0` tokens itself (`ssh-keygen -Y sign -n <namespace>`, per `https://exe.dev/docs/https-api-local-key`) and uses them as `Authorization: Bearer` on a WebSocket upgrade to the VM's HTTPS terminal endpoint — a working example of VM-scoped tokens.
- **`sshminisig`** — compact encoding of an SSH signature (one-byte algorithm prefix + base64url sig) used inside `exe0` tokens; stdlib-only Go "so that it'll be easier to port to other languages".
- **`bin/exe-ssh-config-generator`** — runs `ssh -i <key> exe.dev ls --json` per key, writes `~/.ssh/exe-dev-config` with per-VM `Host` entries + pinned known_hosts ("All exe.dev VMs share the same host key (SSH proxy)"), and includes it from `~/.ssh/config`. `which_keys.sh` matches `ssh exe.dev whoami --json` fingerprint to a local key.

## Notable techniques worth stealing (for a pi-based factory)

1. **Merge queue as the only gate; give agents `mq --dry-run`.** Implement as a script: rebase onto main → run *entire* suite → push. Ship a second entrypoint that stops before push and hand it to every pi worker as its "done" check.
2. **Let the queue amend commits** (self-healing tests, formatting) rather than bouncing to a dead context window.
3. **Numbered-review skill + review-the-review loop.** Write a `codereview` skill for pi with the "1., 2a., 2b." numbering; orchestrate: build → review → human answers by number → same reviewer context fixes → repeat until only known-disagreements remain.
4. **Inventory of tiny named bots on their own VMs, each with a restricted tool list** — exactly the sketch.dev 11-line loop; the Lethal Trifecta as the design check.
5. **Botiquette** — bot channel separation; every bot post links to where it runs and its source.
6. **Secret injection at the edge / short-lived identity tokens** — for a self-hosted stack, an HTTP proxy sidecar per worker that rewrites `Host` and adds `Authorization`, attached by tag; plus OIDC issuance for cloud creds.
7. **Image practices from exeuntu:** unminimized Ubuntu, systemd with growfs and persistent journal, one `AGENTS.md` symlinked into every agent's config dir, agents installed from checksum-verified release binaries by a tiny Go updater (pi from the prebuilt `pi-linux-x64.tar.gz`, so no Node needed), `fd` pre-seeded, first-boot `/exe.dev/setup` oneshot, `machine-id` emptied last.
8. **pi extension pattern** for provider injection + system-prompt context, gated on a filesystem marker.
9. **Differential spec analysis** — N concurrent builds, agents diff each other's decisions, distilled into a terse guidance doc before the keeper build.
10. **"Ask for the design after the build"** — cheap documentation that captures the surprises.
11. **Personalize OSS tools via nightly rebase-cron prompt** — applies directly to pi (Crawshaw: "The source code is the extension system").

## Weaknesses / open questions / risks

- The merge-queue and inventory posts are descriptive, not prescriptive: no code for their merge queue, no details on how the queue re-commits self-healed tests or how it serializes (batching? bisection?). "More on this in a future post" (as of 2026-08-26 not published).
- The agent "inbox" view, Sisyphus, Athena, security scanner: no source released; only described.
- Bot tool restriction is asserted, not shown.
- The SKILL.md is deliberately thin; an agent driving exe.dev needs to fetch `docs.md` anyway.
- exeuntu's SSH story is opaque: in-image sshd is masked, so how `ssh <vm>.exe.xyz` reaches a shell is platform-side (undocumented in the repo).
- Expensively-Quadratic pricing math uses Opus 4.5 rates from Feb 2026; recompute for current models.

## Fit for our agentic stack

pi is first-class in exeuntu (installed as `exedev` from GitHub release binaries, with an official exe.dev pi extension), so a golden image `FROM ghcr.io/boldsoftware/exeuntu` needs zero pi work; `ARG PI_VERSION` pins it. The practices port cleanly to any sandbox provider: merge queue with agent dry-run, numbered cascading review, small named bots, secrets-at-the-edge. Adopt the practices regardless of whether exe.dev is the chosen sandbox.

## Related resources mentioned

- https://sketch.dev/blog/agent-loop — the "11 lines" agent loop.
- https://commaok.xyz/ai/review-the-reviews/ and /ai/codebase-as-prompt/ — Josh Bleecher Snyder's cross-posts; https://commaok.xyz/ai/vibed-static-analysis/ (completeinit).
- https://meat.dev — LLM diff minimizer for review.
- https://simonwillison.net — "cognitive debt" and "Lethal Trifecta" (referenced).
- https://flueframework.com and https://github.com/withastro/flue/blob/main/blueprints/sandbox--exedev.md — Flue agent framework with exe.dev sandbox connector.
- https://exe.dev/docs/https-api and https://exe.dev/docs/https-api-local-key — token minting docs.
- https://exe.dev/docs/integrations-slack , /integrations-slack-bot — Slack integrations.
- https://pushover.net — paging.
- https://github.com/earendil-works/pi/releases — prebuilt pi binaries exeuntu installs from.

## Key quotes / references

- "7 people. 9 workflows. (Not a joke!)" — /bones-of-the-software-factory
- "Let the computer drive the computer." / "With agents, CI is useless, the merge queue is vastly superior." — /replace-your-ci
- "I watch the watchers." — /review-the-reviews
- "an agent is just 11 lines of code" — /inventory
- "Yes, the build queue modifies the commit on its way through if necessary." — /inventory
- "What grants your server, and your agents, the ability to use the secret is their ability to reach your secrets HTTP proxy." — /http-proxy-secrets
- "give the agent an identity and let it obtain narrowly scoped, short-lived access when it needs it." — /oauth-for-agents
- "It was shocking how many important decisions the agents never asked about but simply made—and made differently." — /claude-is-not-a-compiler
- "Never invent a token value. It must come from the user." — exedev-flue/exedev.md
- "We believe that minimal containers make for terrible developer (and agent) experiences" — exeuntu README

**Gaps:** All eight target posts fetched directly (no archive needed); `/everyone-is-building-a-software-factory` does not exist — the post lives at `/bones-of-the-software-factory`. Not read: `integration_catalog.ts` internals, `opencode-plugin/exe-dev.js`, `exe-scroll.zig`, and the full `exedev.ts` SSH code. exeuntu's CI workflow (weekly cron rebuild, GH_VERSION override) is referenced in comments but no `.github/workflows` dir exists in the public repo. No public source for the merge queue, Athena, Sisyphus, or the agent inbox.
