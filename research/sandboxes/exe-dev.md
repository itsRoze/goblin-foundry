# exe.dev

- **URL:** https://exe.dev/ — docs: https://exe.dev/docs (agent-readable index: https://exe.dev/docs.md, https://exe.dev/llms.txt) — blog: https://blog.exe.dev/ — GitHub: https://github.com/boldsoftware (exeuntu image, exe.dev skill)
- **Type:** sandbox
- **Author/Org:** Bold Software, Inc. — founders David Crawshaw (ex-Tailscale CTO) and Josh Bleecher Snyder (ex-Braintree, Go core). ~7-person team.
- **Researched:** 2026-08-26
- **Status/maturity:** Commercial, closed-source platform (the `exeuntu` base image and the agent skill are open source). Public launch Dec 2025 ("Meet exe.dev, Modern VMs"), Series A April 2026 ($35M total raised), listed on AWS Marketplace, iOS app (June 2026), multi-region (US/UK/JP/DE/AU). Very active: blog posts several times a week, docs release notes through May 2026.

## One-paragraph summary

exe.dev sells "computers for developers and agents": persistent Linux KVM VMs that you create with `ssh exe.dev new` in about two seconds, each with root, systemd, a persistent disk, a public HTTPS hostname (`https://<vm>.exe.xyz/`) behind exe.dev's auth-aware proxy, and SSH at `<vm>.exe.xyz`. The pricing model is a *pooled* CPU/RAM allotment ($20/mo for 2 vCPU / 8 GB shared across up to 50 VMs) rather than per-VM billing, which is explicitly designed to make "spin up ten sandboxes" a non-decision. The default image (`exeuntu`) ships with `claude`, `codex`, `pi` and their own web agent Shelley pre-installed; the whole control plane is the SSH command set, mirrored 1:1 as an HTTPS API (`POST https://exe.dev/exec` with SSH-key-signed, scope-limited bearer tokens). Secrets are handled by "integrations" that inject credentials at the network edge so an agent inside the VM can *use* GitHub/Anthropic/Stripe/AWS without ever being able to read the key. Their positioning is "a VM, not a container; persistent, not serverless" — agents that come back tomorrow, run services, and hold state.

## Core ideas / thesis

- **"Agent security is unsolved; a virtual machine is pragmatic."** Give the agent its own computer with nothing on it to exfiltrate, let it run with no permission prompts, and put the blast radius at the VM boundary. From the docs: "Want a VM to try out agent-of-the-week on a project where it cannot trash your laptop's dot files (or bug you for permission to `ls` every five seconds)? Run `ssh exe.dev new`."
- **Persistent, serverful, "more like a laptop than a remote container."** Disks persist and are backed up; cron/systemd timers just work; agents can both build *and operate* the thing they built. Contrast with E2B/Modal-style short-lived execution containers.
- **Pooled compute, marginal VM cost ≈ 0.** "You buy a pool of CPU, RAM, and disk. You get as many VMs as you like." Idle VMs aren't hibernated; their unused share is reallocated to active VMs with no boot delay.
- **SSH is the API.** Every operation is a command over `ssh exe.dev`; the HTTPS API is literally that command in a POST body. Agents can be handed a scoped SSH-signed token and drive the platform themselves (including creating more VMs — "VMs that spin up other VMs").
- **Secrets belong in the proxy, not the VM.** Integrations inject headers at the edge (`stripe.int.exe.xyz`, `llm.int.exe.xyz`, `github` token plumbing, AWS/GCP workload-identity federation), so a compromised or prompt-injected agent can't leak keys.
- **"Everyone is building a software factory"** (blog, Mar 2026): the foundational primitive is "plentiful, performant, trivial-to-provision VMs that can be accessed from your phone or anywhere, that can be shared securely"; DevProd teams should not impose one workflow on top.

## Architecture & mechanics

**Hypervisor / boot.** Bare-metal hosts rented by exe.dev; VMs run on a crosvm-derived VMM on KVM (docs still say Cloud Hypervisor; HN comment from the team says that's outdated). A VM is booted from an OCI *container image* (default `exeuntu`, Ubuntu-derived, Dockerfile at github.com/boldsoftware/exeuntu) laid onto a block device with an overlay — "creating a new VM take[s] about two seconds." Trade-off: you don't pick the kernel. Any Docker image works (`--image=ubuntu:22.04`, private registries via `--registry-auth`). OCI labels tune behaviour: `LABEL exe.dev/install-shelley=true`, `LABEL exe.dev/login-user=...`.

**Networking.** No per-VM public IP. exe.dev terminates TLS and proxies `https://<vm>.exe.xyz/` to the VM (port auto-picked from `EXPOSE`, else `share port <vm> <port>`); ports 3000–9999 are also reachable as `https://<vm>.exe.xyz:<port>/` for authorized users. Proxies are **private by default** (visitor must log into exe.dev) — `share set-public <vm>` flips one port public; `share add <vm> <email|team> [--root]` shares with people/teams; "Login with exe" passes identity headers to your app. SSH is routed by hostname via an sshpiper-style proxy ("SSH Has No Host Header" blog). Custom domains/wildcard certs via `domain add`. Outbound egress is unrestricted (no egress allowlist feature found — see risks).

**Resource model.** Plan tiers are a *pool*: Small 2 vCPU/8 GB ($20 individual, $25/user team), Medium 4/16 ($40/$50), Large 8/32 ($80/$100), XLarge 16/64 ($160/$200). Up to 50 VMs per pool; one VM may take the whole pool (`resize --cpu --memory`). Default VM disk 25 GB (100 GB pooled on Small); overage $0.08/GiB-month averaged over the cycle; outbound bandwidth 200 GB (personal) / 250 GB (team) then $0.05/GB. Team **pools** are reserved-capacity slices: `pool new <name> --cpus=N --region=<r> [--max-vms=M]` (CPUs a power of two from 2–128), `new --pool=<name>`. A "Reserved Cloud Pool" tier is $35.84/hr for 512 vCPU / 2048 GB (thousands of VMs, AWS VPC integration). The /sandbox marketing page additionally quotes usage pricing: CPU $0.05/core-hour, active memory $0.016/GiB-hour, disk $0.08/GiB-month, idle VMs at disk-only rates. Every plan includes a $20/mo Shelley token credit; tokens are billed at provider list price with no markup.

**CLI (all via `ssh exe.dev <cmd>`; `--json` on everything).** `new`, `ls`, `rm`, `restart`, `rename`, `cp`, `resize`, `comment`, `tag`, `share`, `domain`, `set-region`, `ssh-key`, `integrations`, `team`, `pool`, `billing`, `invite`, `shelley`, `browser`, `stat`, `whoami`, `grant-support-root`, `help`, `doc`.

```sh
# create
ssh exe.dev new                                       # auto-named VM, exeuntu, 2 vCPU
ssh exe.dev new --name=b --image=ubuntu:22.04
ssh exe.dev new --cpu=4 --memory=16GB --disk=50GB --tag=prod,staging
ssh exe.dev new --env FOO=bar --integration=myproxy --pool=build
cat setup.sh | ssh exe.dev new --setup-script /dev/stdin   # runs /exe.dev/setup once, first boot (<=10 KiB)
echo 'build me a web app' | ssh exe.dev new --prompt=/dev/stdin   # kick Shelley immediately
# or set a default setup script for all future VMs:
cat script | ssh exe.dev defaults write dev.exe new.setup-script

# clone (this is the "snapshot": copy a prepared VM's disk)
ssh exe.dev cp golden-vm worker-01 --cpu=2 --memory=4GB --pool=build --copy-tags=false

# inspect / manage
ssh exe.dev ls --json | jq '.vms[] | {vm_name,status,ssh_dest,https_url,region}'
ssh exe.dev stat my-vm --range=7d
ssh exe.dev resize my-vm --cpu=8 --memory=32GB
ssh exe.dev rm worker-01

# use the VM
ssh worker-01.exe.xyz 'cd repo && claude -p "run the tests and fix failures"'
scp -r ./spec worker-01.exe.xyz:~/repo/
```

**HTTPS API.** One endpoint; body is the SSH command; JSON output always on.

```sh
ssh exe.dev ssh-key generate-api-key --label=ci --cmds=ls,new,rm --exp=90d   # server-minted, scoped
curl -X POST https://exe.dev/exec -H "Authorization: Bearer exe1.AAA" -d 'new --name=restless'
```

Tokens are `exe0.<base64url(permissions JSON)>.<ssh-signature>`; you can mint them **offline** with `ssh-keygen -Y sign -n v0@exe.dev` (or `-n v0@<vm>.exe.xyz` for VM-scoped tokens that authenticate to the VM's own HTTPS endpoint and pass a signed `ctx` through as `X-ExeDev-Token-Ctx`). Permission fields: `exp`, `nbf`, `cmds` (default `["help","ls","new","whoami","ssh-key list","share show","exe0-to-exe1","team","team members"]`), `ctx`. Removing the SSH key revokes every token it signed. `exe0-to-exe1` exchanges a long token for a short opaque handle.

**Integrations (edge secret injection).** `integrations add <type> --name X ... --attach <vm|tag|auto:all>`; secrets read from stdin with `--openai-key=-`. Defaults on every account: `reflection` (VM metadata at `reflection.int.exe.xyz`) and `llm` (managed Anthropic/OpenAI/Fireworks at `https://llm.int.exe.xyz/v1/models`, so Claude Code/Codex/Shelley in a VM need no API key; ChatGPT-subscription and BYOK variants exist). Others: HTTP proxy (`--strip-prefix`), GitHub (`--act-as-user`, `--readonly`, works with `gh`), VM-to-VM keys, Slack/Discord bots with tokens held off-VM, AWS/GCP workload identity federation, token-mint, 100+ catalog services. The VM "can *use* the integration but can never read the secret."

**Agents in the box.** `exeuntu` pre-installs `claude`, `codex`, `pi`; `sudo exeuntu update claude` refreshes them. Shelley (their web agent, systemd service on port 9999, `https://<vm>.shelley.exe.xyz/`) has generations/compaction, a Chromium browser tool, BYOK, reads `AGENTS.md` / `CLAUDE.md` / `DEAR_LLM.md`, and can be driven from the lobby: `ssh exe.dev shelley prompt --model=... --reasoning=high <vm> "<prompt>"`. An agent skill for teaching *your* agent to drive exe.dev lives at github.com/boldsoftware/exe.dev/blob/main/skill/SKILL.md and points to `https://exe.dev/docs.md`.

**Other:** `browser` opens an in-browser terminal; the iOS app shares screenshots/files/voice memos to a VM's Shelley; receive/send email per VM; regions `set-region`; teams with roles (billing_owner/admin/user), SSO, admin SSH into member VMs, `share add mybox team --root`.

## Workflow: end to end

1. **Golden image.** Either publish a Docker image (`FROM ghcr.io/boldsoftware/exeuntu` + toolchain + `LABEL exe.dev/install-shelley=true`) or create one VM, clone the repo, warm caches, and keep it as `golden`. Attach a GitHub integration (read-only or act-as-user) and the default `llm` integration by tag: `integrations attach github-myrepo --tag=worker`.
2. **Fan out.** Orchestrator (a script, or Claude Code with the exe.dev skill and a token scoped to `cmds=new,cp,ls,rm,ssh-key add`) runs `ssh exe.dev cp golden worker-$i --tag=worker` per task, or `new --image=... --setup-script` from stdin. ~2 s per VM; all draw on the pool.
3. **Run.** `ssh worker-$i.exe.xyz 'cd repo && git checkout -b task-$i && claude -p "$(cat task.md)" --output-format stream-json'`, or push a prompt to Shelley via `shelley prompt`. Because the proxy injects the Anthropic/GitHub credentials, the VM has no `.env` to leak. Long jobs survive laptop sleep; agent can `gh pr create` via the GitHub integration.
4. **Observe / intervene.** `ssh exe.dev stat`, `ls --json`, browser terminal, Shelley UI on phone; share the VM's dev server with a reviewer via `share add worker-3 alice@x.com` or set-public for a preview URL.
5. **Verify / merge.** exe.dev's own recommendation is a *merge queue instead of CI* ("Replace Your CI With a Merge Queue"): run the whole test suite pre-merge in the agent's VM so failures land while the agent's context is still alive; provide an agent variant of the merge command that does everything except the final merge.
6. **Tear down or keep.** `rm worker-$i`, or keep it as a persistent dev/test/prod box (their "Dev, Test, Prod: choose one, two, or three" pattern). Disks persist; idle VMs cost nothing extra beyond disk overage.

## Notable techniques worth stealing

- **SSH-as-API with signed-JSON capability tokens.** Permissions embedded in the token, signed by an SSH key you already have, mintable offline, revoked by removing the key. Trivially scoped per agent (`cmds`, `exp`, `nbf`, `ctx`). Steal for any internal control plane an agent must call.
- **Edge secret injection (`*.int.exe.xyz`).** Agent talks to `https://llm.int.exe.xyz` / `stripe.int.exe.xyz`; proxy adds the Authorization header. Combine with tag-based attachment so every `--tag=worker` VM automatically gets exactly the credentials it needs. Reproducible locally with an HTTP proxy sidecar per container.
- **Pool billing, not per-VM billing** — removes the economic hesitation to parallelize; idle capacity flows to busy VMs.
- **Boot from OCI image + overlay** for ~2 s VM creation while keeping full-VM isolation. `cp` of a warmed VM as the practical "snapshot".
- **`--setup-script` via stdin and `defaults write dev.exe new.setup-script`** — declarative first-boot provisioning without a new file format.
- **Pre-installed agents + no-key LLM gateway** in the base image: a fresh VM can run `claude` immediately.
- **Progressive-disclosure docs for agents** (`/docs.md`, `/llms.txt`, a SKILL.md) — the platform ships its own agent skill.
- **"Reflection" integration**: a VM can discover its own tags, comments, owner email, and attached integrations at runtime — cheap way to pass task metadata to an agent inside a sandbox (`comment` field, tags).
- **Merge queue > CI** for agent-written code; "cascading review" (Review the Reviews); "Botiquette" norms for bots in shared channels.
- **VM-to-VM integration with edge-generated keys** — agents on different VMs can call each other over HTTPS with per-pair credentials, enabling orchestrator→worker HTTP without shared secrets.

## Weaknesses / open questions / risks

- **No true memory/disk snapshot or fork-from-running-state, no scale-to-zero.** Only `cp` (disk clone of a VM). No documented pause/resume with memory, no CoW fork like Sprites/boxd/E2B pause. Persistent VMs are always "on" (billing is by pool, so this is mostly a design difference, but it means no checkpoint/rollback for agent experiments).
- **No egress control.** I found no outbound-network allowlist/firewall; the isolation story is "there's nothing in the VM to steal," not "the VM can't talk to the internet." Data you copy in (repo, test fixtures) is exfiltratable by a prompt-injected agent.
- **Hard caps: 50 VMs per pool, pooled 2–16 vCPU on self-serve plans.** Running 20 parallel Claude Code sessions each compiling on a 2-vCPU pool will crawl; realistic parallelism needs Large/XLarge or a team pool (`pool new --cpus=32`) or the Cloud Pool tier. Disk overage bites: 25 GB default × many clones vs 100 GB pooled.
- **No SDK.** API is SSH/curl; no Python/TS client (vs E2B, Daytona, Sprites, Modal). Fine for shell-driven orchestration, less fine for typed integration.
- **No custom kernel, no nested virt documented, no GPUs.** Docker inside VM works (FAQ "Can I run docker images?"), but heavy workloads aren't the target.
- **Closed-source, single vendor, no self-host** (boxd's comparison lists this explicitly). Lock-in mitigated by "it's just Linux, rsync out" and the open exeuntu Dockerfile.
- **Security page is thin**: disclosure email and one bulletin (Feb 2026: shared VMs exposed all proxied ports to share recipients, not just the intended one). No SOC2 statement found.
- **Bandwidth ceilings** (200–250 GB outbound) drew HN criticism for production hosting; irrelevant for sandboxes, relevant if you serve previews.
- **Docs drift**: architecture text says Cloud Hypervisor, team says crosvm-derived; HN launch said 25 VMs/25 GB, current docs say 50 VMs/100 GB pooled. Pricing shown on /sandbox (usage rates) vs /pricing (pool tiers) — unclear which self-serve accounts actually get.
- Open: how fast is `cp` of a 20 GB VM? Is there an image cache per account? Rate limits on `/exec` (429 documented, numbers not)?

## Fit for our agentic stack

As the **sandbox/execution layer for parallel Claude Code agents**, exe.dev is a strong "persistent worker VM" option and a weaker "ephemeral per-task microVM" option.

**Adopt**
- Use it for long-running or stateful agent workers: a warmed `golden` VM per repo (deps, caches, `claude` logged in via the `llm` integration or `ANTHROPIC_API_KEY`-free gateway), `cp` per task, run `claude -p ... --output-format stream-json` over SSH, collect the PR, `rm`. All orchestration is plain `ssh`/`jq` — fits a shell-driven factory with no SDK.
- Give the orchestrator agent an `exe0` token limited to `cmds=cp,new,ls,rm,stat` with a 24 h `exp`; give workers *no* platform token at all (or one scoped to `ssh-key add` for their own subkeys).
- Route all model/GitHub/Slack access through integrations attached by tag so worker VMs contain zero secrets. This is the cleanest secret story of any option surveyed.
- Use the VM's public private-by-default HTTPS proxy as the "preview URL" for reviewers, and `share add <vm> team --root` for human take-over of a stuck agent from the browser terminal or phone.
- Adopt their merge-queue-not-CI stance and run the full suite inside the worker VM before the agent hands off.

**Adapt**
- Treat `cp` as the snapshot primitive and keep a small fleet of pre-cloned idle workers ("pre-running VMs") to hide clone time; cap fan-out to (pool vCPU / 2) concurrent builds.
- For Claude Code specifically, still enable Claude Code's own sandbox inside the VM if you want file/egress limits — exe.dev gives VM isolation, not egress policy.
- Budget: Large individual ($80) or team Large ($100/user, plus reserved `pool`) is the realistic floor for >4 concurrent heavy agents.

**Skip / look elsewhere**
- If you need sub-second, thousands-per-day ephemeral sandboxes with memory snapshots and forking (evaluation harnesses, test-per-commit), use Sprites/E2B/Modal/boxd instead.
- If you need egress allowlists or SOC2 paperwork, this isn't it yet.
- Shelley itself is not needed in a Claude Code-centric stack; disable with `sudo systemctl disable --now shelley.service` or build your own image without the label.

## Landscape: alternatives

| Option | Isolation | Start / snapshot | Persistence & idle | Networking | API/SDK | Pricing (public) | Best for |
|---|---|---|---|---|---|---|---|
| **exe.dev** | KVM VM (crosvm-derived) | ~2 s create from OCI image; `cp` disk clone; no memory snapshot | Persistent disk, always-on, no scale-to-zero; idle share reallocated | Public HTTPS hostname behind auth proxy, SSH by name, edge secret injection; no egress policy | SSH commands + `POST /exec`; SSH-signed scoped tokens; no SDK | $20/mo pool 2 vCPU/8 GB, 50 VMs; up to $160/mo 16/64; usage rates $0.05/core-hr on /sandbox page | Persistent agent workers, dev/test/prod boxes, phone-accessible agents |
| **Fly.io Sprites** (sprites.dev) | Firecracker microVM | "slow create, fast start/stop"; disk checkpoints ~300 ms, last 5 kept, CoW | Persistent 100 GB NVMe, scale-to-zero, idle storage $0.02/GB-mo | HTTPS URL, DNS-based allow/deny egress policy | REST + Go/TS SDKs, CLI, MCP server | $0.07/CPU-hr + $0.04375/GB-hr, plans $20–2000/mo by concurrency; ~$0.46 for a 4 h session | Ephemeral-but-resumable agent sandboxes with rollback |
| **E2B** | Firecracker microVM | ~150 ms start from template; pause/resume with memory (4 s/GiB pause, ~1 s resume), kept indefinitely | Paused sandboxes persist; 1 h max session on Hobby, 24 h+ Pro | Public URL per port, internet on/off flag | Python/JS SDK (`Sandbox.create()`, `sandbox.commands.run`), self-hostable | $0.0504/vCPU-hr + $0.0162/GiB-hr; Hobby free ($100 credit, 20 concurrent), Pro $150/mo | Code-execution tool for agents, eval harnesses |
| **Daytona** | OCI container (+Kata/Sysbox opt.) | <90 ms cold start; snapshots/images | Stateful workspaces, auto-stop | Preview URLs, egress control | Python/TS SDK, AGPL core self-host | $0.0504/vCPU-hr, $0.0162/GiB-hr, $0.000108/GiB-hr storage; $200 free credit | Devbox-style sandboxes with SDK, self-host option |
| **Modal Sandboxes** | gVisor on KVM | Seconds; image caching; filesystem snapshots | Ephemeral by default; auto-shutdown | Tunnels, egress control | Python SDK (`modal.Sandbox.create`) | $0.1419/core-hr (2 vCPU) + $0.0242/GiB-hr, $0.09/GiB-mo; GPUs | Batch/GPU workloads, Python-native orchestration |
| **Fly Machines** | Firecracker microVM | Sub-second start from stopped; no memory snapshot | Volumes; stop/start, autostop | Anycast IPs, private WireGuard net | REST API, `flyctl` | ~$0.0000022/s shared 1x, volumes $0.15/GB-mo | Bring-your-own orchestrator, full control |
| **Vercel Sandbox** | Firecracker microVM | Fast; filesystem snapshots (GA) | Ephemeral | Public URL | TS SDK, AI SDK integration | $0.128/vCPU-hr active + $0.0212/GB-hr | Vercel-native agent apps |
| **Cloudflare Sandboxes/Containers** | V8 isolates + container preview | Fast | Ephemeral | Workers routing | Workers API | $0.072/vCPU-hr active | Edge, short tasks |
| **Northflank Sandboxes** | Kata on K8s | Seconds | Persistent volumes | Ingress | API, BYOC | $0.01667/vCPU-hr + $0.00833/GB-hr | Cost-sensitive large fleets (200 sandboxes ≈ $7.2k vs $16.8k E2B/Daytona) |
| **boxd** (boxd.sh) | Linux VM | Sub-ms resume; 60 ms CoW fork of running state | Hibernate-to-zero; 100 GB disk, 50 VMs | HTTPS, DNS, reverse proxy | CLI `--json`, gRPC, SDKs; open source, self-host (one Rust binary) | Credit-based usage | exe.dev-like DX with forking and self-host |
| **Docker/devcontainer local** (Claude Code devcontainer, Dagger container-use, AgentBox, clodpod) | Container (or macOS VM) | Instant; overlay per agent | Local disk | Host network unless firewalled (Claude's devcontainer has an iptables allowlist) | Compose/CLI | Free | Cheapest parallel worktrees on one machine |
| **Anthropic built-ins** | Claude Code Bash sandbox: Seatbelt (macOS) / bubblewrap + seccomp (Linux) + filtering network proxy; Claude Code web/cloud sessions & Managed Agents run in Anthropic-hosted microVMs | Instant (in-process) | n/a | Domain allowlist via proxy | `/sandbox`, `settings.json` `sandbox.*` keys; `srt` open-source runtime | Included | Defense-in-depth *inside* whichever VM you choose |
| **rivet sandbox-agent** | (runs inside any sandbox above) | — | — | HTTP/SSE control plane | `POST /sessions`, `/messages`, `GET /events`; TS SDK; supports Claude Code, Codex, Amp, OpenCode, Cursor, Pi; Apache-2 | Free | Uniform remote control of agents across sandbox vendors |

Takeaway: exe.dev competes on *persistent, cheap-to-multiply, secret-safe* VMs with great human ergonomics (phone, share, HTTPS), not on fast snapshot/fork or SDK depth. For a Claude Code factory, the practical pairing is exe.dev (or Sprites) as the worker VM layer + Claude Code's own sandbox for in-VM policy + something like sandbox-agent for a uniform control API.

## Related resources mentioned

- https://github.com/boldsoftware/exeuntu — open-source base image Dockerfile; base for custom worker images.
- https://github.com/boldsoftware/exe.dev/blob/main/skill/SKILL.md — official agent skill for driving exe.dev; drop into `.claude/skills/`.
- https://sprites.dev / Simon Willison's writeup — closest competitor with checkpoints + egress policy; deserves its own file.
- https://boxd.sh — open-source, self-hostable exe.dev-alike with CoW fork; deserves a look for on-prem.
- https://github.com/rivet-dev/sandbox-agent — HTTP control plane for Claude Code/Amp/Codex inside sandboxes (1.5k stars, Apache-2).
- https://gist.github.com/wincent/2752d8d97727577050c043e4ff9e386e — "List of coding agent sandboxes 2026-05", the most complete directory found.
- https://blog.exe.dev/replace-your-ci, /review-the-reviews, /inventory, /bones-of-the-software-factory — exe's own software-factory practices (merge queue, cascading review, ~10 internal agents "just 11 lines of code").
- https://blog.exe.dev/http-proxy-secrets and /oauth-for-agents — secret-injection and identity-for-agents patterns.
- https://blog.exe.dev/how-antithesis-turned-exe-into-a-sandbox-for-agentic-software-tests — Antithesis (Carl Sverre) using exe VMs for Claude remote-control sessions and planning "VMs that spin up other VMs".
- https://code.claude.com/docs/en/sandboxing and /sandbox-environments — Anthropic's in-agent sandbox; complementary layer.
- https://northflank.com/blog/ai-sandbox-pricing — 2026 rate table across vendors.

## Key quotes / references

- "Your VMs share CPU/RAM—you pay for underlying resources, not per VM. Make a bunch!" — docs, *What is exe.dev?*
- "An 'exe.dev' VM runs on a bare metal machine that exe.dev rents… Exe.dev instead starts with a container image (by default, 'exeuntu'), and hooks it up with a block device with the image on it. This makes creating a new VM take about two seconds." — docs, *How does exe.dev work?*
- "The exe.dev HTTPS API is nothing but the SSH API shoved into a POST body." — docs, *HTTPS API*
- "The VM — and any agent running on it — can *use* the integration but can never read the secret." — docs, *Integrations*
- "Agent security is unsolved; a virtual machine is pragmatic." — docs, *Put your agent in a VM and let it be*
- "When you create a VM with `ssh exe.dev new`, `claude`, `codex`, and `pi` are pre-installed." — docs, *Running Agents*
- "plentiful, performant, trivial-to-provision VMs that can be accessed from your phone or anywhere, that can be shared securely" — blog, *Everyone Is Building a Software Factory*
- "By the time automated failures arrive, the agent context window is dead and gone." — blog, *Replace Your CI With a Merge Queue*
- HN launch thread: https://news.ycombinator.com/item?id=46397609 ; Series A: https://news.ycombinator.com/item?id=47865682 ; team comment on crosvm: https://news.ycombinator.com/item?id=46397861

**Gaps:** exe.dev doc pages are client-rendered, so several (`/docs/https-api`, `/docs/release-notes`, `/docs/billing/usage`) had to be read from the `/docs/all` bundle via curl; the ethantroy.dev and ypwu.net hands-on posts returned 403. No official statement on clone (`cp`) latency, `/exec` rate limits, egress filtering, or SOC2 was found.
