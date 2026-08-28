# Modal Sandboxes
- **URL:** https://modal.com/docs/guide/sandbox (product page: https://modal.com/products/sandboxes; pricing: https://modal.com/pricing)
- **Type:** sandbox
- **Author/Org:** Modal Labs (NYC; founders Erik Bernhardsson, Akshat Bubna)
- **Researched:** 2026-08-26
- **Status/maturity:** GA product (Sandboxes are a first-class primitive alongside Functions). SDKs: `modal-labs/modal-client` (Python + JS + Go now in one monorepo) — 510 stars, Apache-2.0, pushed 2026-08-26, latest Python tag v1.3.1 on GitHub while the docs changelog lists 1.5.4 (2026-08-12) (tag/changelog mismatch noted; unverified which is canonical). `modal-labs/libmodal` (former JS/Go home) is **archived** (2026-07-18) — JS lives at npm `modal` (v0.9.0, 2026-07-09) and Go at `github.com/modal-labs/modal-client/go`. `modal-labs/modal-examples` 1,262 stars, MIT. The platform itself is closed-source; only the client SDKs are open. SOC 2 Type II; HIPAA via BAA (Enterprise). New "Sandbox V2" scheduling backend in **beta** (blog 2026-07-16, SDK 1.5.4 via `MODAL_SANDBOX_V2=1`).

## One-paragraph summary
Modal Sandboxes are gVisor-isolated containers spun up on demand from the Modal Python/JS/Go SDK, billed per second, with a max lifetime of 24 h, an optional `idle_timeout`, filesystem snapshots (delta images), directory snapshots, experimental memory snapshots (7-day TTL, clone semantics, terminates the source), Volumes for persistence, egress control (`block_network`, `outbound_cidr_allowlist`, beta `outbound_domain_allowlist`), TLS tunnels for ingress, and a Secrets object that injects env vars. Modal's own examples run Claude Code and OpenCode inside Sandboxes with `pty=True`, which is the exact pattern needed for pi. Sandbox compute is priced ~3x Modal's Function rate ($0.1419 per physical core-hour, $0.024 per GiB-hour), there is a $30/mo free credit on the $0 Starter plan (100 containers), and the estimated cost for our 10-agent, 4 h/day workload is roughly **$210–$335/month** depending on whether "2 vCPU" is requested as 1 or 2 Modal physical cores (see arithmetic). Weaknesses: slowest measured cold start of the major providers (~2.4 s in LogRocket's Aug-2026 test, vs Modal's own p50 <500 ms claim for V2), no in-place pause/resume (snapshot = terminate + reboot), memory snapshots still `_experimental`, Python-centric (needs an `App` object), and several 2026 incidents.

## Core ideas / thesis
- Sandboxes are "secure containers for executing untrusted user or agent code on Modal" — one primitive inside a serverless platform (Functions, Volumes, Secrets, Queues, Dicts, GPUs) rather than a standalone sandbox product.
- Everything is defined in code (Image builder DSL, no YAML/Dockerfile required, although `from_dockerfile`/`dockerfile_commands` are supported).
- Scale is the selling point: "1B+ sandboxes run", "100k+ concurrent", demo of 1M concurrent created in <60 s on the V2 backend (https://modal.com/blog/scaling-to-1-million-concurrent-sandboxes-in-seconds, 2026-07-16). Customers cited: Lovable, Ramp (background coding agent), Applied Compute (RL).
- Billing only while a sandbox is alive; `idle_timeout` and short `timeout` are the intended cost controls ("scale to zero").
- Unique among peers: sandboxes can hold GPUs; Docker-in-Sandbox support is advertised for coding agents.

## Architecture & mechanics
- **Isolation:** gVisor (runsc) user-space kernel on Modal's own worker fleet ("gVisor on KVM" per the wincent gist); Rust runtime/storage layer. Docs: https://modal.com/docs/guide/security. Not Firecracker microVMs. Sidecars (alpha) are sibling containers on a private bridge network with the sandbox.
- **Cold start numbers:** Modal claims "sub-second scheduling" and, for V2, median start <500 ms with scheduling latency in the tens of ms (blog, 2026-07-16). Independent measurement (LogRocket, 2026-08-04): create = **2437 ms**, boot-from-snapshot = **2347 ms** — "Modal and Blaxel had the slowest create times". Treat 0.5–2.5 s as the realistic range; irrelevant for a 4-hour agent session.
- **Scheduling backend:** V1 relied on Postgres strong consistency with O(sandboxes) writes; V2 uses a fleet of stateless scheduling servers routing probabilistically on in-memory worker load, workers publish state to Redis streams asynchronously; "two network hops and one cheap CPU op" on the create path. Opt-in: `MODAL_SANDBOX_V2=1` (SDK 1.5.4, 2026-08-12).
- **Lifecycle states:** Created → Scheduled → Started → Ready (optional readiness probe, TCP or exec, max 5 min) → Finished.
- **Snapshots** (https://modal.com/docs/guide/sandbox-snapshots):
  - *Filesystem snapshot* — `sb.snapshot_filesystem()` returns an `Image` (delta vs base image, only modified files stored). Default TTL 30 days (`ttl=` param). Use to build "repo cloned + deps installed" golden images.
  - *Directory snapshot* — `sb.snapshot_directory("/path")`, later `mount_image()` into a running sandbox; 30-day TTL. JS example includes customer-supplied encryption key (CSEK).
  - *Memory snapshot (experimental)* — `Sandbox.create(..., _experimental_enable_snapshot=True)`, then `snap = sb._experimental_snapshot()` and `Sandbox._experimental_from_snapshot(snap)`. Exact clone incl. running processes and RAM. Caveats: **terminates the original**, 7-day TTL that cannot be extended and is inherited along re-snapshot chains, cannot snapshot while an `exec` is running, background `exec` processes do not restore properly, TCP connections drop, no GPUs, restore requires the same instance type (may delay scheduling). No published restore latency.
  - **No in-place pause/resume.** "Filesystem/memory snapshot; no in-place resume" (LogRocket). For >24 h work, docs say to use filesystem snapshots across sandbox instances.
- **Persistence & idle/auto-stop:** `timeout` default 300 s, **max 24 h**; `idle_timeout` terminates when there are no running commands, stdin writes, or open TCP connections. Volumes (`modal.Volume`, background commits every few seconds; Volumes v2 with explicit `sync`; `reload_volumes()` to see external writes) and CloudBucketMounts (S3/GCS/R2) for durable data. Ephemeral disk default 512 GiB per container, max 3 TiB (billed as memory at 20:1).
- **Networking:** Default: no inbound, no access to Modal resources. Ingress via `encrypted_ports=[...]` (random `https://xxx.r5.modal.host` URLs, public), `unencrypted_ports` (raw TCP, random port), `h2_ports`, `custom_domain`; tunnels are free. `inbound_cidr_allowlist` and **Connect Tokens** (`sb.create_connect_token(port=..., user_metadata=...)`, server sees `X-Verified-User-Data`) for authenticated access. Egress: `block_network=True`; `outbound_cidr_allowlist=[...]` (any protocol); `outbound_domain_allowlist=["api.anthropic.com","*.github.com"]` (beta, TLS/443 only, wildcards; added SDK 1.5.0 2026-06-09); allowlists are additive; runtime policy change via `sb._experimental_set_outbound_network_policy()` (alpha). HTTP proxy env support (`HTTPS_PROXY`) since 1.5.1. `proxy=` for static egress IPs (Modal Proxies).
- **Secrets model:** `modal.Secret` objects injected as env vars — `Secret.from_name("x", required_keys=[...])` (created via `modal secret create NAME KEY=VAL` or dashboard), `from_dict`, `from_dotenv`, `from_local_environ`. Attach at `Sandbox.create(secrets=[...])` or per-`exec(secrets=[...])`. Limits: key ≤16,384 chars, value ≤32,768. Scoped to workspace Environment. Alpha "Sidecar" pattern keeps the API key out of the sandbox entirely (Caddy proxy sidecar injects the header; sandbox has `outbound_cidr_allowlist=[]`). Sandbox also supports `include_oidc_identity_token=True` for federated cloud creds.
- **Limits:** Starter plan 100 concurrent containers / 10 GPU concurrency / 3 seats / 1-day logs; Team ($250/mo) 5,000 containers / 50 GPU / 30-day logs. Max session 24 h. CPU request min 0.125 core (default), default soft limit request+16 cores, `cpu=(request, limit)`; memory default 128 MiB, `memory=(request, limit)` for hard OOM limit. Modal "cores" are **physical cores** (Northflank: "physical core-hr (2 vCPU)"). Max cpu/memory per sandbox "enforced at creation" but not published. Sidecars: ≤250 per sandbox.
- **Regions/cloud:** multi-cloud (AWS/GCP/OCI workers; docs list regions not providers): broad `us`, `eu`, `ap`, `uk`, `ca`, `me`, `sa`, `af`, `mx`; narrow `us-east/central/south/west`, `eu-west/north/south`, `ap-northeast/southeast/south`, `jp`, `au`, etc. Pinning costs **1.5x (broad) / 1.75x (narrow)** on compute. Non-preemptible capacity is 3x. Default (no region) is cheapest.
- **OSS/self-host:** Client SDKs Apache-2.0; platform proprietary; **no self-host, no BYOC** (Northflank: "Managed only").
- **Reliability:** status.modal.com incidents in 2026: 2026-05-07 SEV1 (AWS AZ overheating), 2026-05-19, 2026-06-03 (auth system), June 2026 database incident affecting Sandboxes ~1 h, HN "Modal Major Outage" thread (id 48384115, could not fetch — 429), last acknowledged 2026-07-30.

## API / SDK (concrete)
**Languages:** Python (`pip install modal`, primary), JavaScript/TypeScript (`npm install modal`, Node ≥22, ESM+CJS, "approaching feature parity"; defining Functions stays Python-only), Go (`go get github.com/modal-labs/modal-client/go@latest`), community Ruby. Auth: `modal setup` writes `~/.modal.toml`; headless: `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET`.

Python (verified against docs + `modal-examples/13_sandboxes/sandbox_agent.py`):
```python
import modal

app = modal.App.lookup("goblin-foundry", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("curl", "git", "ripgrep", "ca-certificates")
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs",
        "npm install -g @earendil-works/pi-coding-agent",
    )
    .env({"PI_HOME": "/root"})
)
# optional: image = image.build(app)   # eager build; Image.publish()/from_name() for named images (SDK 1.5.0)

sb = modal.Sandbox.create(
    app=app,
    image=image,
    cpu=1.0,               # physical cores (≈2 vCPU); tuple (request, limit) allowed
    memory=4096,           # MiB; (4096, 8192) for hard limit
    timeout=6 * 3600,      # max 24h
    idle_timeout=15 * 60,
    workdir="/work",
    secrets=[modal.Secret.from_name("llm-keys", required_keys=["ANTHROPIC_API_KEY"]),
             modal.Secret.from_dict({"GH_TOKEN": "..."})],
    outbound_domain_allowlist=["api.anthropic.com", "api.openai.com", "*.github.com",
                               "github.com", "registry.npmjs.org", "pypi.org", "files.pythonhosted.org"],
    volumes={"/cache": modal.Volume.from_name("pi-cache", create_if_missing=True)},
    encrypted_ports=[3000],          # optional ingress: sb.tunnels()[3000].url
    name="agent-07", tags={"task": "issue-123"},
)

p = sb.exec("git", "clone", "--depth", "1", "https://github.com/me/repo", "/work/repo")
p.wait()

pi = sb.exec("pi", "-p", "--mode", "json", "Fix issue #123",
             pty=True, workdir="/work/repo", timeout=3 * 3600)
for line in pi.stdout:          # streams line-by-line (StreamReader; .read() for all)
    print(line, end="")
pi.wait(); print(pi.returncode)

diff = sb.exec("git", "diff", workdir="/work/repo").stdout.read()
sb.filesystem.copy_to_local("/work/repo/patch.diff", "./patch-07.diff")   # also write_text/read_text/list_files/stat/remove
sb.filesystem.write_text("...", "/work/prompt.md")

snap_img = sb.snapshot_filesystem(ttl=7*24*3600)     # reuse: Sandbox.create(image=snap_img, ...)
sb.terminate(wait=True); sb.detach()
# later: modal.Sandbox.from_id(sb_id) / Sandbox.from_name("goblin-foundry", "agent-07") / Sandbox.list(app_id=..., tags={...})
```
Older `sb.open()/ls/mkdir/rm/watch` are deprecated in favour of `sb.filesystem.*` (reads ≤5 GB, writes any size). `exec` options: `pty`, `workdir`, `timeout`, `env`, `secrets`, `text`, `bufsize`, `stdout=StreamType.PIPE|STDOUT|DEVNULL`; `p.stdin.write(); p.stdin.drain()`; `p.poll()`.

JS (from `modal-client/js/examples/sandbox-agent.ts`):
```ts
import { ModalClient } from "modal";
const modal = new ModalClient();
const app = await modal.apps.fromName("goblin-foundry", { createIfMissing: true });
const image = modal.images.fromRegistry("node:24-bookworm-slim").dockerfileCommands([
  "RUN apt-get update && apt-get install -y git ripgrep curl",
  "RUN npm install -g @earendil-works/pi-coding-agent",
]);
const sb = await modal.sandboxes.create(app, image, { cpu: 1, memory: 4096, timeout: 6*3600*1000 });
const p = await sb.exec(["pi", "-p", "Fix the failing test"], {
  pty: true, workdir: "/repo",
  secrets: [await modal.secrets.fromName("llm-keys", { requiredKeys: ["ANTHROPIC_API_KEY"] })],
});
await p.wait(); console.log(await p.stdout.readText());
await sb.terminate();
```
JS examples also cover filesystem snapshot, directory snapshot (+CSEK), tunnels, connect tokens, volumes, cloud buckets, runtime network policy, image prewarm.

CLI: `modal setup`, `modal secret create NAME K=V`, `modal volume create/put/get`, `modal container list/stop --graceful`, `modal sandbox list/terminate` (the sandbox CLI reference page 404'd; existence of `modal sandbox` subcommands unverified), `modal shell`, `modal skills` (1.5.0, agent dev helpers), `modal curl`.

## Workflow: end to end (for our factory)
1. **Image:** one `modal.Image` with Node 24 + `@earendil-works/pi-coding-agent` + git/gh/ripgrep; `Image.publish()` as a named image, or build once and call `.build(app)` eagerly (Modal caches per layer; `MODAL_FORCE_BUILD=1` to bust).
2. **Golden snapshot per repo:** create one sandbox, clone the repo and warm `npm ci`/`uv sync`, then `sb.snapshot_filesystem(ttl=30d)` → reuse that Image for all N agents (only deltas stored). Refresh nightly.
3. **Fan-out:** orchestrator (local script or a Modal Function) loops `Sandbox.create(image=golden, name=f"agent-{i}", tags={"task": id}, timeout=5h, idle_timeout=20min, secrets=[...], outbound_domain_allowlist=[...])`. 10 sandboxes are well under the Starter cap of 100 containers.
4. **Run:** `sb.exec("pi", "-p", "--mode", "json", prompt, pty=True, workdir="/work/repo")`; stream stdout into logs; pi's session JSONL lands in `~/.pi/agent/sessions` — copy it out with `sb.filesystem.copy_to_local` or mount a Volume at `/root/.pi/agent/sessions`. Auth: write `~/.pi/agent/auth.json` from a Secret at start, or use env keys.
5. **Collect:** `git diff`/`git format-patch` via exec, or `git push` a branch with `GH_TOKEN` (allowlist github.com) and open PRs with `gh`.
6. **Teardown:** `sb.terminate(wait=True)`; rely on `timeout` as a hard cap. Optional: `Sandbox.list(app_id, tags)` sweeper Function on a `modal.Period` cron.
7. **Resume:** if a task needs >24 h or a human review pause, `snapshot_filesystem()` and re-create; memory snapshots are not yet reliable enough (experimental, 7-day TTL, kills source).

## Pricing
Source: https://modal.com/pricing and https://modal.com/products/sandboxes (fetched 2026-08-26).
- **Sandbox CPU:** $0.00003942 per **physical core**-second = $0.1419/core-hour (3x the Function rate of $0.0000131). Minimum 0.125 core. Billed on max(request, usage) per second.
- **Sandbox memory:** $0.00000667 per GiB-second = $0.024/GiB-hour.
- **GPU (per sec):** T4 $0.000164, L40S $0.000542, A100-80GB $0.000694, H100 $0.001097, H200 $0.001261, B200 $0.001736, B300 $0.001972.
- **Storage:** Volumes $0.09/GiB-month after 1 TiB free. Tunnels free. Snapshots stored as images (no separate rate found).
- **Multipliers:** region pinning 1.5x/1.75x; non-preemptible 3x.
- **Plans:** Starter $0/mo + **$30/mo free credit**, 100 containers, 10 GPU concurrency, 3 seats, 1-day logs. Team $250/mo + $100 credit, 5,000 containers, 50 GPU concurrency, 30-day logs. Enterprise custom.

**Estimate for 10 sandboxes × "2 vCPU" × 4 GiB × 4 h/day × 22 days = 880 sandbox-hours:**
- If 2 vCPU is requested as `cpu=1.0` physical core (Modal core = 2 vCPU per Northflank's reading): CPU 880 × $0.1419 = **$124.87**; RAM 880 × 4 × $0.024 = **$84.48**; total ≈ **$209/mo**, minus $30 credit ≈ **$179/mo**.
- If requested as `cpu=2.0` (2 physical cores = 4 vCPU): CPU $249.74 + RAM $84.48 ≈ **$334/mo** (≈$304 after credit).
- At 8 GiB RAM: add $84.48 → ≈ $294 (1 core) / $419 (2 cores).
- Plan fee $0 (Starter suffices). Idle cost 0 once terminated; a sandbox waiting for LLM responses still bills its requested core/RAM, so `idle_timeout` matters. Storage effectively free at our scale. Region pinning would multiply compute by 1.5x.
- Cross-check: Northflank's 200-sandbox always-on example priced Modal at $24,491/mo vs E2B/Daytona $16,819 — Modal is the priciest managed option per always-on hour, but per-second scale-to-zero narrows this for bursty agent runs.

## Notable techniques worth stealing
- **Delta filesystem snapshots as images** (only changed files stored) — cheap "golden repo" images per project.
- **Directory snapshots mounted into a running sandbox** — decouple dependency cache from repo state.
- **Sidecar secret injection** (`sidecar_secrets_injection.py`): agent sandbox with `outbound_cidr_allowlist=[]`, Caddy sidecar holding the API key and rewriting `x-api-key`; `ANTHROPIC_BASE_URL` points at the sidecar. Keeps keys out of the agent's reach even if pi is prompt-injected.
- **Domain allowlist + additive CIDR allowlist** for egress; runtime policy tightening after clone/install.
- **Warm sandbox pool via `modal.Queue`** with readiness probes and self-tracked `expires_at` (`sandbox_pool.py`; Modal doesn't expose remaining lifetime).
- **Readiness probes** (`Probe.with_exec`/`with_tcp`) + `wait_until_ready()`.
- **Connect Tokens** (`X-Verified-User-Data`) for authenticated per-user access to a dev server in the sandbox.
- **Named sandboxes + tags + `Sandbox.list`** for idempotent orchestration and sweepers.
- Their "coding agent" examples uniformly use `pty=True` for Claude Code/OpenCode — pi will likely need the same.

## Weaknesses / open questions / risks
- Slowest measured cold start among peers (~2.4 s, LogRocket 2026-08) vs Modal's own <500 ms p50 claim (V2 beta). Not critical for us.
- No pause/resume in place; memory snapshots are `_experimental_`, 7-day TTL, terminate the source, no restore latency published, "background exec processes don't restore" — a running pi process is exactly that.
- 24 h hard cap per sandbox.
- Physical-core billing semantics: unclear whether `cpu=1` gives 2 vCPU of Node throughput for pi; need to benchmark. Max CPU/RAM per sandbox not published.
- Python-first: sandbox creation needs an `App` object and Modal's Image DSL; JS SDK is younger (0.9.0) but has parity for sandbox ops.
- Managed only; no self-host/BYOC. Platform not OSS.
- Reliability: multiple 2026 SEV incidents including a Sandboxes-affecting database incident (June 2026) and an HN-front-page outage.
- Pricing complexity: 3x sandbox premium over Functions, region multipliers, a $30 credit that only covers ~15% of our estimate.
- Tunnel URLs are public if leaked (random but unauthenticated) unless Connect Tokens / inbound CIDR are used.
- Domain allowlist is beta and TLS-only; git over SSH would need CIDR rules.
- Sidecars are alpha and allowlist-gated.

## Fit for our agentic stack
- **pi preinstallable?** Yes, trivially: `Image.debian_slim().apt_install("curl","git","ripgrep").run_commands("curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs", "npm i -g @earendil-works/pi-coding-agent")` or `Image.from_registry("node:24-bookworm-slim").dockerfile_commands([...])` (JS/Go) / `Image.from_dockerfile()`. Config/auth via `image.add_local_file(..., copy=True)` for `settings.json` and a Secret for `auth.json` contents written at start. Run headless with `sb.exec("pi","-p",..., pty=True)`; `--mode rpc` works via `p.stdin.write()`/`stdout` streaming.
- **Verdict:** Strong fit for a 10-parallel batch factory: per-second billing, `idle_timeout`, hard `timeout`, domain-level egress allowlists, filesystem snapshots for per-repo golden images, first-party Claude Code/OpenCode examples, and no plan fee at our scale (~$180–$335/mo). Best choice if we also want GPUs or Modal Functions for orchestration/cron. Weaker than Firecracker-based rivals (E2B/Daytona) on pause/resume and cold start, and pricier per always-on hour, so prefer it for "run to completion" tasks rather than long-lived interactive workspaces.

## Related resources mentioned
- Modal Sandbox pool gist (pawalt): https://gist.github.com/pawalt/7a505c38bba75cafae0780a5dd40e8b8
- Modal examples `13_sandboxes/` (sandbox_agent.py = Claude Code, opencode_server.py, sandbox_pool.py, sidecar_secrets_injection.py, harbor_evals.py, safe_code_execution.py, cua)
- Modal JS reference: https://modal-labs.github.io/libmodal/
- Blog "Scaling to 1M concurrent sandboxes in seconds" (2026-07-16) + HN https://news.ycombinator.com/item?id=48940231
- Modal "Best sandbox for OpenHands / Claude Agent SDK / coding agents in 2026" listicles (marketing; competitors named: E2B, Northflank, Daytona, Fly.io Sprites, Cloudflare Workers Sandbox, Blaxel)
- Northflank AI sandbox pricing comparison (2026-05-05), LogRocket comparison (2026-08-04), AgenticWire Modal vs E2B (2026-07-08), particula.tech and startuphub.ai comparisons
- wincent gist: Modal = "gVisor on KVM; GPU-friendly; auto-shutdown when agent finishes"

## Key quotes / references
- "Sandboxes are secure containers for executing untrusted user or agent code on Modal." — docs/guide/sandbox
- "A default Sandbox has no ability to accept incoming network connections or access your Modal resources." — docs/guide/sandbox-networking
- "Filesystem Snapshots ... calculate the difference from your base image, so only modified files are stored." — docs/guide/sandbox-snapshots
- "Snapshotting terminates the original Sandbox ... Memory snapshots expire 7 days after creation." — same
- "New performant Sandbox backend with substantially higher creation rates and concurrency via `MODAL_SANDBOX_V2=1`" — changelog 1.5.4, 2026-08-12
- "Modal and Blaxel had the slowest create times, at 2437ms and 2824ms respectively." — LogRocket, 2026-08-04
- "Adding a PTY is important, since Claude requires it" — modal-examples sandbox_agent.py
- Pricing: "$0.00003942 per core per second (minimum 0.125 cores); $0.00000667 per GiB per second; $30/month free compute credit" — modal.com/products/sandboxes
- "Modal ... is the only platform where a sandbox can hold a GPU" — Northflank pricing post

**Gaps:** (1) HN "Modal Major Outage" thread and status.modal.com postmortems not fetched (429/blocked) — dates from third-party trackers only. (2) `modal sandbox` CLI reference page 404'd; subcommand list unverified. (3) Published max CPU/RAM per sandbox and exact per-plan *sandbox* concurrency (vs "containers") not found. (4) Memory-snapshot restore latency not published. (5) "Physical core = 2 vCPU" comes from Northflank, not Modal docs — needs confirmation. (6) GitHub tag (v1.3.1) vs changelog (1.5.4) discrepancy for modal-client unresolved. (7) Docker-in-Sandbox guide page 404'd; only marketing mention. (8) Did not verify whether pi's `-p` mode needs a PTY on Modal.
