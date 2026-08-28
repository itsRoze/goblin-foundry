# Daytona

- **URL:** https://www.daytona.io — docs https://www.daytona.io/docs — legacy OSS https://github.com/daytonaio/daytona — new SDK/CLI monorepo https://github.com/daytona/clients
- **Type:** sandbox (managed cloud; BYOC runners; legacy self-host via archived AGPL repo)
- **Author/Org:** Daytona Platforms Inc. (VC-backed; Ivan Burazin et al.)
- **Researched:** 2026-08-26
- **Status/maturity:** GA managed service, weekly releases (v0.207.0 on 2026-08-24). `daytonaio/daytona`: 71,868 stars, 5,646 forks, license **AGPL-3.0** (LICENSE at tag v0.190.0), last push 2026-07-24, last commit 2026-06-25, last release v0.190.0 (2026-06-23). README banner: "**This repository is no longer maintained.** As of June 2026, Daytona's core development has moved to a private codebase." (repo is *not* GitHub-archived, just frozen). Clients (SDKs, CLI, MCP) moved to `github.com/daytona/clients` (relicensed Apache-2.0 per changelog v0.191.0, 2026-06-25; repo license shows NOASSERTION, i.e. mixed/custom LICENSES dir).

## One-paragraph summary
Daytona is a managed "sandbox as a service" for running AI-generated code: OCI/Docker-image-based container sandboxes (default class) that start in ~90 ms from a pre-pulled snapshot, plus newer Linux-VM, Windows and GPU classes. Every sandbox is a full persistent computer (root, its own filesystem, network namespace, allocated vCPU/RAM/disk) driven by SDKs in Python/TypeScript/Go/Ruby/Java, a CLI, REST API and MCP server, with a rich in-sandbox "toolbox" API (exec, sessions, PTY, fs, git, LSP, computer-use). It bills per second for reserved vCPU/RAM/disk, has aggressive lifecycle automation (auto-stop 15 min idle → auto-archive 7 d → optional auto-delete/TTL), S3-backed shared volumes, proxied preview URLs, a domain/CIDR egress firewall, and a clever secrets model where the sandbox only ever sees a placeholder that an outbound proxy swaps for the real value on HTTPS to allow-listed hosts. As of June 2026 the core platform went closed source (security rationale), so "self-host" now means either running the frozen AGPL v0.190.0 or attaching your own runner nodes (BYOC custom regions) to Daytona's hosted control plane. Notably Daytona ships an official **pi extension** (`@daytona/pi`, `pi --daytona`) that runs pi's tool calls inside a sandbox and syncs each session to its own GitHub branch.

## Core ideas / thesis
- "Sandboxes are full composable computers" — persistent stateful workspaces, not throwaway function runners; stop/start keeps the filesystem, archive tiers it to object storage for free.
- Speed via pre-built **snapshots** (OCI images pre-pulled to runners) and **warm pools**; "sub 90 ms sandbox creation from code to execution" (marketing; third-party measured 71 ms create / 67 ms exec / 59 ms cleanup, ~197 ms total — pixeljets.com, July 2025).
- Everything is programmable: SDK-first, declarative `Image` builder (Modal-style), git/fs/process/PTY toolbox, webhooks, OTel export.
- Security posture shifted to "openness is a liability in the AI-vuln-discovery era" (June 2026 closed-source post): "AI can now be pointed at an open source repository and systematically search it for exploitable flaws, at a speed and scale no human team can match."

## Architecture & mechanics
**Planes (docs/architecture):** Interface plane (SDKs, CLI, dashboard, MCP, SSH); Control plane (NestJS **API**, **Proxy** with host-based routing `{port}-{sandboxId}.{proxy-domain}`, **Snapshot builder**, **Sandbox manager/scheduler**); Compute plane (**Runners** — Go binaries that poll the API for jobs and execute sandbox ops; **Daemon** inside each sandbox exposing the Toolbox API; **Snapshot store** = internal OCI registry on S3-compatible storage; **Volumes** = FUSE mounts over S3). Supporting: Postgres, Redis, Auth0/OIDC, S3. Legacy repo layout confirms: `apps/{api,runner,daemon,proxy,ssh-gateway,snapshot-manager,dashboard,cli,otel-collector}`; runner packages include `docker`, `netrules`, `sshgateway`, `storage`.

**Isolation tech (by sandbox class, docs/isolation + docs/sandboxes):**
| Class | Isolation | Resources (shared regions) | Features |
|---|---|---|---|
| Container (default) | "Isolated container with dedicated namespaces and enforced resource limits. Code runs as root inside the sandbox without affecting the runner" — Docker/OCI containers sharing host kernel; cgroup hard limits | default 1 vCPU/1 GiB/3 GiB; max 4 vCPU/8 GiB/10 GiB | ~90 ms create, dynamic image builds, archive, cold snapshot, docker-in-docker via pre-configured images |
| Linux VM | "Full virtual machine with its own kernel" (hypervisor unspecified) | 1–4 vCPU, 1–8 GiB, 3–10 GiB | pause/resume (memory kept), fork, hot (memory) snapshots; no Dockerfile builds |
| Windows VM | VM | 1–4 vCPU, 4–16 GiB, 30–50 GiB | as Linux VM; $0.0858/vCPU-h extra |
| GPU | "Isolated container with exclusive GPU allocation" | up to 8 GPUs; each adds 16 vCPU/192 GiB/512 GiB | ephemeral (deleted on stop) |
Third-party sources (wincent gist, Northflank, pixeljets) describe the OSS runner as "Docker by default, optional Kata Containers / Sysbox"; the current docs do not mention Kata/Sysbox/gVisor at all, and a code search of the legacy repo for "kata", "sysbox", "gvisor" returned nothing via GitHub code search (may be indexing) — treat Kata/Sysbox as **unverified/legacy**. Northflank (2026-06-12): "Docker containers with shared host kernel (not hardware-level isolation)."

**Cold start:** ~90 ms claimed for container class from a pre-pulled snapshot; first use of a new snapshot requires pull/build (async, can take minutes). Warm pools (v0.205.0, Aug 2026) give pre-started sandboxes for zero-wait claims.

**Snapshot/fork/pause semantics:**
- *Image snapshots*: built from a registry image or Dockerfile/declarative `Image`; tag must be pinned (no `latest`); bound to default resources; **auto-deactivate after 2 weeks unused** (re-activation = re-pull delay). Default snapshots: `daytona-small` (1/1/3), `daytona-medium`, `daytona-large` (4/8/10), `daytona-vm-{small,medium,large}`, `windows-*`, `daytona-gpu`. Default image ships Python + 40+ AI libs and **Claude Code preinstalled**.
- *Sandbox snapshots* (`sandbox.create_snapshot(name)`, stable since v0.202.0 2026-07-29): cold = filesystem only (all classes; container must be stopped per snapshots page); hot = fs + memory (VM/Windows only). Snapshots outlive the sandbox and are billed for storage.
- *Fork* (`sandbox.fork(name)`): docs/sandboxes list fork as a VM/Windows feature ("Fork, pause/resume, memory snapshots"); the Python SDK docstring says "creating a new Sandbox with an identical filesystem … copy-on-write". Persistence page: "a parent cannot be deleted while it has active fork children." **Whether container-class fork is supported is ambiguous — verify.**
- *Pause* (VM only): freezes fs+memory, bills disk only; auto-pause default 60 min for VMs.
- *Stop*: container keeps fs, loses memory; bills disk only. *Archive* (container only): fs moved to object storage, **no charge**; restart restores from S3 (slower). *Stopped → archived* default after 7 d (max 30 d).
- *Recovery*: `sandbox.recover()` from recoverable error states; `stop(force=True)` = SIGKILL.

**Persistence & idle:** auto_stop_interval default **15 min** idle ("no new events"; 0 disables); auto_archive default 7 days; auto_delete disabled (0 = delete immediately on stop = `ephemeral=True`); `ttl_minutes` wall-clock kill regardless of state (v0.199.0). SSH sessions keep the sandbox "active". Hot resize of CPU/RAM up while running; disk grow only when stopped.

**Networking:**
- Ingress: `https://{port}-{sandboxId}.proxy.daytona.app` style URLs; private sandboxes need `x-daytona-preview-token` header (token rotates on restart) or a **signed URL** `https://{port}-{token}.{proxy}` (default 60 s expiry, max 24 h); `public=True` disables auth. Any port 1–65535 (22222 reserved). Custom preview proxy supported. SSH via `create_ssh_access()` / `daytona ssh`.
- Egress: three mutually exclusive params — `network_allow_list` (IPv4 CIDRs, max 10), `domain_allow_list` (max 20, `*.example.com` wildcards; added v0.190.0), `network_block_all`. **Tier 1–2: "Network access is restricted and cannot be overridden at the sandbox level"** but "Essential services remain reachable" (package registries npm/PyPI, git hosts, AI/ML providers). Tier 3–4: full internet by default; custom lists replace policy entirely ("Essential services do not bypass a sandbox allow list") and can be changed on a running sandbox. `outbound_proxy_url` (v0.204.0) set at create only. Sandbox-to-sandbox networking off unless **linked** (`linked_sandbox=`; children ephemeral, DNS-addressable by name).
- No bandwidth caps documented.

**Secrets model (docs/secrets, v0.192–0.196):** org-scoped encrypted secrets with a host allow-list; `secrets={"ANTHROPIC_API_KEY": "anthropic-key"}` at create injects a placeholder `dtn_secret_<random>` into the env; the outbound proxy substitutes the real value **only in HTTPS request headers to allowed hosts**, and scrubs responses. "Plaintext values never enter the sandbox." Updates propagate within 15 s. Plain `env_vars` are also supported (visible in-sandbox). API keys have scopes (`write:sandboxes`, `manage:secrets`, …).

**Limits (docs/limits, shared regions):**
| Tier | vCPU | RAM | Disk | API req/min | Sandbox creates/min | Unlock |
|---|---|---|---|---|---|---|
| 1 | 10 | 20 GiB | 30 GiB | 10,000 | 300 | email verified |
| 2 | 100 | 200 GiB | 300 GiB | 20,000 | 400 | credit card + $25 top-up |
| 3 | 250 | 500 GiB | 2,000 GiB | 40,000 | 500 | $500 top-up |
| 4 | 500 | 1,000 GiB | 5,000 GiB | 50,000 | 600 | $2,000 top-up every 30 days |
No explicit concurrent-sandbox cap: "resources are shared across all running sandboxes" (stopped sandboxes still hold disk quota until archived). Per-org max sandbox size 4 vCPU/8 GiB/10 GiB in container class. Volumes: 100 per org, free, don't count against disk quota. Regions: `us`, `eu` (`DAYTONA_TARGET`), plus dedicated regions (sales) and **custom regions** (BYOC; "no limits applied for concurrent resource usage").

**OSS / self-host:** Frozen AGPL-3.0 monorepo at v0.190.0 (June 2026) includes api, runner, daemon, proxy, ssh-gateway, snapshot-manager, dashboard, Helm charts (`charts/`), docker compose (`docker/`), and had "OSS deploy guides" (v0.170.0). No further security patches. Going forward: hosted control plane only; BYOC = your Kubernetes runners via `daytona-region` Helm chart registering into a custom region.

## API / SDK (concrete)
SDKs: Python (`pip install daytona`, sync + `AsyncDaytona`, Python ≥3.10), TypeScript (`npm install @daytona/sdk`), Go, Ruby, Java; REST API (`https://app.daytona.io/api`); CLI; MCP server (`daytona mcp init claude`). Auth: `DAYTONA_API_KEY` (+ optional `DAYTONA_API_URL`, `DAYTONA_TARGET=us|eu`), or JWT from `daytona login` with `DAYTONA_ORGANIZATION_ID`.

```python
from daytona import (Daytona, DaytonaConfig, Image, CreateSnapshotParams,
                     CreateSandboxFromSnapshotParams, CreateSandboxFromImageParams,
                     Resources, SessionExecuteRequest)
daytona = Daytona(DaytonaConfig(api_key="...", target="us"))

# 1) build an image snapshot with pi preinstalled (declarative builder)
image = (Image.base("node:24-bookworm")
         .run_commands("npm install -g @earendil-works/pi-coding-agent",
                       "apt-get update && apt-get install -y git ripgrep")
         .env({"CI": "1"}).workdir("/home/daytona"))
daytona.snapshot.create(CreateSnapshotParams(name="pi-agent-v1", image=image,
                        resources=Resources(cpu=2, memory=4, disk=8)), on_logs=print)
# CLI equivalent: daytona snapshot create pi-agent-v1 -f Dockerfile --cpu 2 --memory 4 --disk 8

# 2) create sandbox from snapshot with secrets, egress policy, lifecycle timers
sb = daytona.create(CreateSandboxFromSnapshotParams(
    snapshot="pi-agent-v1", name="agent-01", labels={"task": "issue-123"},
    env_vars={"GIT_AUTHOR_NAME": "pi-bot"},
    secrets={"ANTHROPIC_API_KEY": "anthropic-key", "GH_TOKEN": "github-pat"},   # placeholder injection
    domain_allow_list="api.anthropic.com,github.com,*.github.com,registry.npmjs.org",  # Tier 3+ only
    auto_stop_interval=30, auto_archive_interval=60*24, ttl_minutes=6*60, ephemeral=False))
# or from image directly: daytona.create(CreateSandboxFromImageParams(image="ubuntu:22.04", resources=Resources(cpu=2, memory=4, disk=8)))

# 3) run commands / stream output
r = sb.process.exec("pi --version", cwd="/home/daytona", timeout=60); print(r.exit_code, r.result)
sb.git.clone(url="https://github.com/acme/repo.git", path="/home/daytona/repo", branch="main",
             username="git", password=os.environ["GH_TOKEN"])
sb.process.create_session("agent")
cmd = sb.process.execute_session_command("agent", SessionExecuteRequest(
    command="cd /home/daytona/repo && pi -p 'fix issue #123' --mode json > /tmp/pi.jsonl", run_async=True))
await sb.process.get_session_command_logs_async("agent", cmd.cmd_id,
    lambda out: print(out, end=""), lambda err: print(err, end=""))
# PTY variant (used in Daytona's Claude Code guide):
pty = sb.process.create_pty_session(id="pi", cwd="/home/daytona/repo", on_data=lambda d: print(d.decode(), end=""))
pty.send_input("pi -p 'hello'\n"); pty.wait(timeout=600); pty.kill()

# 4) files
sb.fs.upload_file(b"...", "/home/daytona/repo/task.md"); sb.fs.upload_files([...])
patch = sb.fs.download_file("/tmp/changes.patch"); sb.fs.download_file("/tmp/pi.jsonl", "local.jsonl")
sb.fs.search_files("/home/daytona/repo", "*.ts"); sb.fs.find_files(path="repo", pattern="TODO")

# 5) ports / preview
link = sb.get_preview_link(3000)           # link.url, link.token (header x-daytona-preview-token)
signed = sb.create_signed_preview_url(3000, expires_in_seconds=3600)

# 6) lifecycle
sb.stop(); sb.start(); sb.archive(); sb.create_snapshot("agent-01-done"); child = sb.fork("agent-01-b")
sb.set_autostop_interval(0); sb.set_ttl(240); sb.resize(Resources(cpu=4, memory=8))
daytona.delete(sb)   # or sb.delete()
for s in daytona.list(): ...      # paginated, searchable (labels)
vol = daytona.volume.create("shared-cache")   # mount: volumes=[VolumeMount(volume_id=vol.id, mount_path="/cache")]
daytona.secret.create(CreateSecretParams(name="anthropic-key", value="sk-ant-...", hosts=["api.anthropic.com"]))
pool = daytona.warm_pool.create(...)         # TS: daytona.warmPool.create({snapshot, pool: 3, target: 'us'})
```
TypeScript mirrors: `new Daytona({apiKey, target})`, `daytona.create({snapshot, envVars, labels, resources, autoStopInterval, autoDeleteInterval, volumes, networkAllowList, networkBlockAll, ephemeral, user})`, `sandbox.process.executeCommand(cmd, cwd, env, timeout)`, `codeRun`, `createSession/executeSessionCommand({command, runAsync})`, `getSessionCommandLogs(sid, cid, onStdout, onStderr)`, `createPty({id, cwd, onData})`, `fs.uploadFile(Buffer, path)`, `fs.downloadFile`, `git.clone(url, path, branch, commitId, username, password)`, `git.push(path, user, token)`, `getPreviewLink(port)`, `createSignedPreviewUrl`, `fork()`, `createSnapshot()`, `archive()`, `waitUntilStarted()`.

CLI: `brew install daytonaio/cli/daytona` (or curl release binary); `daytona login --api-key KEY`; `daytona create --snapshot pi-agent-v1 --cpu 2 --memory 4096 --disk 8 --auto-stop 30 --env K=V --label task=123 --volume ID:/path [--network-block-all|--network-allow-list CIDR]`; `daytona list -f json`; `daytona exec SANDBOX -- pi -p "..."`; `daytona ssh SANDBOX`; `daytona preview-url SANDBOX -p 3000`; `daytona stop/start/delete [-a]`; `daytona snapshot create NAME -f Dockerfile --cpu 1 --memory 1 --disk 3`; `daytona snapshot push NAME -n SNAP` (push local Docker image); `daytona volume create NAME -s SIZE_GB`; `daytona mcp init claude`.

## Workflow: end to end (for our factory)
1. **Image**: Dockerfile `FROM node:24-bookworm` (pi needs Node ≥24; Daytona base image must be pinned tag) → `npm i -g @earendil-works/pi-coding-agent`, git, ripgrep, language toolchains; bake `~/.pi/agent/settings.json` (no auth.json — inject keys via secrets). `daytona snapshot create pi-agent-v1 -f Dockerfile --cpu 2 --memory 4 --disk 8`. Optionally `daytona.warm_pool.create({snapshot:'pi-agent-v1', pool: 3})` for instant claims (costs run-time while idle).
2. **Fan-out**: orchestrator (TS, using `@daytona/sdk`) creates N=10 sandboxes from the snapshot with `labels={run, task}`, `secrets={ANTHROPIC_API_KEY, GH_TOKEN}`, `auto_stop_interval=20`, `ttl_minutes=300`, `ephemeral` off (keep for debugging), egress `domain_allow_list` (needs Tier 3; on Tier 1–2 rely on the built-in "essential services" allow-list which already covers GitHub/npm/PyPI/AI providers). Note warm-pool claims require *no* custom env/volumes/secrets — so secrets must come from the baked image or be written post-claim.
3. **Per-agent**: `sb.git.clone(repo, path, branch=f"agent/{id}", username="git", password=GH_TOKEN)`; `execute_session_command(run_async=True)` → `pi -p "<task>" --mode json > /tmp/pi.jsonl`; stream logs via `get_session_command_logs_async` or websocket lifecycle events (v0.198.0); poll `get_session_command` for exit code.
4. **Collect**: `sb.git.add/commit/push` to `agent/<id>` branch (Daytona's own pi extension does exactly this: agent commits, host pushes via the git API), or `sb.process.exec("git diff main > /tmp/out.patch")` + `fs.download_file`. Download `/tmp/pi.jsonl` and the pi session JSONL from `~/.pi/agent/sessions`.
5. **Teardown**: `daytona.delete(sb)`; or `sb.create_snapshot(f"run-{id}")` for forensic replay then delete. Auto-stop + auto-archive are the safety net (archived = $0).
Alternative: skip orchestration and use the official `pi --daytona --repo github.com/acme/api --branch dev --snapshot pi-agent-v1` extension per session (runs pi *locally*, tools remote, auto-branches `pi/<session>`), which is interactive-first, not headless.

## Pricing
Source: https://www.daytona.io/pricing (2026-08-26). Per-second billing; no minimums/subscription; $200 free credits on signup; volume discounts unstated. Container class: **$0.0504/vCPU-h, $0.0162/GiB-RAM-h, $0.000108/GiB-disk-h (first 5 GiB free)**; Windows +$0.0858/vCPU-h; GPUs $0.57–2.61/h. Billed while *started/creating/stopping*; **stopped/paused = disk only; archived = $0**; snapshots from sandboxes billed for storage (rate unstated); volumes free.

Our load: 10 sandboxes × 2 vCPU × 4 GiB × 4 h/day × 22 days = 88 sandbox-hours each.
- CPU: 10 × 2 × $0.0504 = $1.008/h; RAM: 10 × 4 × $0.0162 = $0.648/h → **$1.656/h** → × 88 h = **$145.73/mo**.
- Disk: 8 GiB × 10 = 80 GiB; if sandboxes are kept stopped between runs: (80 − 5) × $0.000108 × 720 h ≈ **$5.83/mo**; if deleted/archived after each run: ~80 × 0.000108 × 88 ≈ $0.76.
- 8 GiB RAM variant: 10 × 8 × 0.0162 = $1.296 + $1.008 = $2.304/h × 88 = **$202.75/mo**.
- Total ≈ **$150–210/month**, first ~1 month covered by the $200 free credit. Plan gate: 10 × 2 vCPU = 20 vCPU concurrent exceeds Tier 1 (10 vCPU) → need **Tier 2** (credit card + $25 top-up; 100 vCPU/200 GiB) — but Tier 2 still has org-enforced egress restrictions; custom allow-lists require **Tier 3 ($500 top-up)**.
Cross-check: Northflank's 200-sandbox comparison prices Daytona at $16,819/mo, identical to E2B at the same 2 vCPU/4 GiB rates.

## Notable techniques worth stealing
- **Placeholder secrets + egress proxy substitution** (`dtn_secret_*` swapped only in HTTPS headers to allow-listed hosts; response scrubbing) — the agent can never exfiltrate a real key.
- **Tiered lifecycle ladder**: idle auto-stop → stopped auto-archive to S3 ($0) → optional auto-delete/TTL wall clock; ephemeral = auto_delete 0.
- **Snapshots as pinned OCI images with auto-deactivation** after 2 weeks; declarative `Image` builder streaming build logs.
- **Warm pools** with strict claim-matching rules (same snapshot/region/resources/no custom env).
- **Session-per-branch git sync** in the pi/OpenCode extensions: agent commits, host pushes to `pi/<session>`; `/pr`, `/merge` slash commands; fork session = fork branch + new sandbox.
- **Linked sandboxes**: ephemeral child sandboxes on a private link network, cascade-deleted with parent (e.g. agent + DB sidecar).
- Toolbox daemon inside the sandbox (exec/sessions/PTY/fs/git/LSP over one API) instead of ssh-per-call.

## Weaknesses / open questions / risks
- **Closed source since 2026-06-11**; OSS repo frozen at v0.190.0 with no security patches — self-hosting the full stack means running unpatched AGPL code. Only BYOC runners remain (hosted control plane).
- Default container class is **shared-kernel Docker isolation**, not microVM; VM class exists but capped at 4 vCPU/8 GiB and cannot build from Dockerfile. Hypervisor for VM class undocumented.
- Container-class max is **4 vCPU / 8 GiB / 10 GiB** — fine for us, but 10 GiB disk is tight for big monorepos + node_modules.
- Egress control is **tier-gated**: custom allow-lists only on Tier 3+ ($500 top-up); Tier 1–2 get an opaque org-level "essential services" policy.
- Warm pools can't carry secrets/env/volumes; snapshot auto-deactivation after 14 days idle adds surprise latency.
- Fork semantics inconsistent between docs pages (VM-only vs. generic CoW) — needs testing for container class.
- Rate of change is very high (weekly breaking-ish releases; experimental→stable renames; TS SDK timeout regressions in July 2026).
- Vendor concentration: small VC-backed company; pricing/tier rules changed several times in 2026.
- Concurrent sandbox limits are implicit (vCPU pool) and stopped sandboxes still consume disk quota until archived.

## Fit for our agentic stack
- **pi preinstallable? Yes, trivially**: custom snapshot `FROM node:24-*` + `npm i -g @earendil-works/pi-coding-agent`, or reuse Daytona's default image (already has Node/Claude Code) and add pi. Daytona even maintains `@daytona/pi` (Apache-2.0, `libs/pi-extension` in the legacy monorepo; `pi install npm:@daytona/pi`) — proof the pair works, though that extension runs the pi *agent locally* with remote tools; for our headless factory we run `pi -p --mode json` *inside* the sandbox via `execute_session_command`/PTY, as in Daytona's Claude Code guide.
- Persistence model (stop/archive/snapshot) suits long-running per-task workspaces and cheap pauses between 4 h shifts; per-second billing at ~$0.17/h per 2 vCPU/4 GiB agent → ~$150–210/mo for our load.
- **Verdict: strong fit for a managed, low-cost, high-API-surface option** — probably the most ergonomic SDK of the group (git/fs/sessions/PTY/secrets built in). Main caveats are container-grade isolation by default, tier-gated egress control, and the loss of a maintained OSS self-host path. Recommend: Tier 2 to start, container class from a pinned `pi-agent` snapshot, secrets via the placeholder mechanism, results via per-agent branches; evaluate VM class for stronger isolation if needed.

## Related resources mentioned
- `@daytona/pi` pi extension — https://www.npmjs.com/package/@daytona/pi, guide https://www.daytona.io/docs/en/guides/pi/pi-extension/
- Daytona clients monorepo (SDKs/CLI/MCP, Apache-2.0) — https://github.com/daytona/clients ; `daytona/skills` (agent skill for Daytona), `daytona/guides`, `daytona/integrations`
- Claude Code guides — https://www.daytona.io/docs/en/guides/claude/claude-code-run-tasks-stream-logs-sandbox/ (PTY + `claude --dangerously-skip-permissions -p ... --output-format stream-json`), CLI variant, Claude Agent SDK two-agent system, Claude Managed Agents on Daytona (`daytona.snapshot_name` metadata)
- OpenCode plugin `@daytona/opencode` (`opencode/N` branch sync over SSH remote) — https://www.daytona.io/docs/en/guides/opencode/opencode-plugin/
- Scott Spence "Claude Code Swarm With Daytona Sandboxes" — https://scottspence.com/posts/claude-code-swarm-daytona-sandboxes (403 on fetch)
- Third-party: Northflank Daytona vs E2B (2026-06-12), Northflank self-hostable alternatives, pixeljets Daytona vs microsandbox (2025-07), wincent sandbox gist, morphllm/StartupHub comparisons; VibeKit (daytona org fork) for running Codex/Claude Code in sandboxes.

## Key quotes / references
- README (2026-06): "This repository is no longer maintained. As of June 2026, Daytona's core development has moved to a private codebase." — https://github.com/daytonaio/daytona
- Closed-source post (2026-06-11): "AI can now be pointed at an open source repository and systematically search it for exploitable flaws…"; "If the threat landscape shifts in a way that makes openness defensible again, we want to revisit it." — https://www.daytona.io/dotfiles/updates/daytona-is-going-closed-source
- Isolation: "Code runs as root inside the sandbox without affecting the runner." — https://www.daytona.io/docs/en/isolation/
- Network: "Tier 1 & 2: Network access is restricted and cannot be overridden at the sandbox level… Essential services remain reachable." — https://www.daytona.io/docs/en/network-limits/
- Secrets: "Daytona sets that environment variable to the placeholder, not to the real value… plain HTTP requests are never substituted." — https://www.daytona.io/docs/en/secrets/
- Persistence: "Stopping a sandbox does not destroy it: the sandbox keeps its identity, its filesystem, and its configuration." — https://www.daytona.io/docs/en/persistence/
- Pricing: vCPU $0.0504/h, GiB RAM $0.0162/h, disk $0.000108/GiB-h after 5 GiB free; "$200 in free compute included"; "All billing is calculated per second." — https://www.daytona.io/pricing
- Limits table — https://www.daytona.io/docs/en/limits/ ; billing by state — https://www.daytona.io/docs/en/billing/
- SDK refs — https://www.daytona.io/docs/en/python-sdk/sync/daytona/ , https://www.daytona.io/docs/en/python-sdk/sync/sandbox/ , https://www.daytona.io/docs/en/typescript-sdk/ ; CLI — https://www.daytona.io/docs/en/tools/cli/
- Changelog (weekly; v0.207.0 2026-08-24) — https://www.daytona.io/changelog ; fork/snapshot stable v0.202.0 — https://www.daytona.io/changelog/stable-sandbox-fork-and-snapshot-creation
- BYOC / runners — https://www.daytona.io/docs/en/bring-your-own-compute/ , https://www.daytona.io/docs/en/runners/ (404 at fetch time); warm pools — https://www.daytona.io/docs/en/warm-pools/

**Gaps:** (1) Hypervisor used for Linux VM class and whether Kata/Sysbox/gVisor are still used anywhere — docs silent, legacy code search inconclusive. (2) Container-class fork support (docs contradictory). (3) Snapshot storage $/GiB and archive restore latency not published. (4) `docs/en/runners/` (customer-managed compute) and `docs/en/sandbox-lifecycle/` returned 404; BYOC hardware requirements and billing unknown. (5) Scott Spence swarm post (403) and any HN thread on the closed-source move not read. (6) Exact composition of Tier 1–2 "essential services" allow-list (does it include all LLM API hosts we need, e.g. OpenRouter?) unverified. (7) Whether the legacy v0.190.0 self-host still works against current SDK versions.
