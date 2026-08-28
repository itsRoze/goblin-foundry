# Cloudflare Sandbox SDK + Cloudflare Containers
- **URL:** https://developers.cloudflare.com/sandbox/ · https://developers.cloudflare.com/containers/ · https://github.com/cloudflare/sandbox-sdk · npm `@cloudflare/sandbox`
- **Type:** sandbox
- **Author/Org:** Cloudflare
- **Researched:** 2026-08-26
- **Status/maturity:** Containers + Sandboxes **GA since 2026-04-13** (Workers Paid plan only). `cloudflare/sandbox-sdk`: **1,118 stars**, 110 forks, **Apache-2.0**, last push 2026-08-26 (very active; releases roughly weekly — `@cloudflare/sandbox@0.12.8` published 2026-08-24). Stable line is 0.12.x; **Sandbox SDK 1.0 preview** on `@cloudflare/sandbox@next` (0.13.0-next.*, since 2026-08-07) with breaking API changes (argv `exec`, RPC-only, sessions removed, `gitCheckout` removed). Cloudflare recommends starting new projects on `@next`.

## One-paragraph summary
Cloudflare Containers is a serverless container runtime where every container instance is bound to a Durable Object (DO) and runs in **its own VM** on Cloudflare's network; you configure it in `wrangler.jsonc` (`containers` + `durable_objects.bindings` + `migrations`), `wrangler deploy` builds your Dockerfile locally and pushes it to Cloudflare's registry, and the container starts lazily on first request and sleeps after `sleepAfter` (default 10 min) idle. The **Sandbox SDK** (`@cloudflare/sandbox`) is a TypeScript layer on top of Containers that ships a base image (`docker.io/cloudflare/sandbox:<ver>`, Ubuntu 22.04 + Node 24 + Bun + git) running a small control server on port 3000, and exposes `getSandbox(env.Sandbox, id)` with `exec`, `startProcess`, `writeFile/readFile`, `gitCheckout`, sessions, a Python/JS/TS code interpreter, PTY terminals, preview URLs / `*.trycloudflare.com` tunnels, R2 FUSE mounts, R2-backed disk backup/restore, and a programmable **egress proxy** (`enableInternet`, `allowedHosts`, `outbound` handlers) that lets the Worker inject API keys so the sandbox never holds real secrets. It is priced on the Containers meters (active-CPU $0.00002/vCPU-s, provisioned memory $0.0000025/GiB-s, disk $0.00000007/GB-s) plus the $5/mo Workers Paid plan. Disk is ephemeral (fresh on every wake); there is no memory snapshot/fork yet — only directory-level squashfs backups to R2.

## Core ideas / thesis
- "Agents have their own computers": each agent/user gets a DO-addressed, globally routable Linux VM that scales to zero; the DO is the control plane, the container is the data plane.
- **Active-CPU billing** (since 2025-11-21): you pay CPU only for cycles actually used, so an agent blocked on an LLM response costs only memory+disk. Cloudflare explicitly markets this for agent loops.
- **Secrets never enter the sandbox**: outbound handlers run in the Workers runtime on the same machine and rewrite headers (credential injection, TLS interception, deny/allow lists).
- Everything is "just Workers": R2, D1, KV, Workers AI bindings reachable from inside the sandbox via `outboundByHost` hostnames; the Worker fronts all ingress (no raw inbound TCP/UDP).
- Treat sandbox state as disposable; persist via R2 (FUSE mount or backup/restore) — "Snapshots (coming soon)" for full state.

## Architecture & mechanics
**Isolation tech.** "Each container instance runs inside its own VM, which provides strong isolation from other workloads running on Cloudflare's network." (containers/platform-details/architecture). Security page: "Each sandbox runs in a separate VM, providing complete isolation." Hypervisor not named publicly (not gVisor/Firecracker per docs; unspecified). Images must be `linux/amd64`. Inside the sandbox all processes share FS/network; the SDK's base image runs a control server (`/container-server/sandbox`, port 3000) that the DO talks to (HTTP transport default on 0.12; RPC over a single WebSocket on 0.9.1+ and the only transport on 1.0).

**Request path.** Client → Worker → Durable Object (Sandbox class extends `Container` extends DO) → container instance. "Durable Objects and their associated Container instances are not guaranteed to run in the same location." Placement picks "the nearest location with a pre-fetched image".

**Cold start.** "Container cold starts can often be in the 1-3 second range, but this is dependent on image size and code execution time." Sandbox SDK adds `containerTimeouts` defaults: `instanceGetTimeoutMS` 30 s (provisioning), `portReadyTimeoutMS` 90 s (control server ready). First deploy: "wait 2-3 minutes for container provisioning" (`wrangler containers list`). Backup restore of a workspace: ~2 s vs ~30 s for fresh clone+`npm install` (GA blog, axios example).

**Snapshot / fork / pause-resume.**
- No memory snapshot, no fork, no pause. Sleep = SIGTERM (then SIGKILL after up to 15 min) and **disk is discarded**: "All disk is ephemeral. When a Container instance goes to sleep, the next time it is started, it will have a fresh disk as defined by its container image." (containers FAQ)
- **Backup/restore API** (2026-02-23): `sandbox.createBackup({dir:'/workspace'})` packs a directory to squashfs and uploads to **your R2 bucket** (`backups/{id}/data.sqsh` + `meta.json`) via presigned URLs; `sandbox.restoreBackup(handle)` mounts it as a FUSE overlayfs (copy-on-write). Default TTL 3 days (259,200 s; enforced at restore). "The FUSE mount is lost when the sandbox sleeps or the container restarts" — you must re-restore. Handle is serializable (store in KV/D1/DO). GA blog: "Future releases will include live memory state."
- Alternative persistence: `mountBucket()` FUSE-mounts R2/S3/GCS (2025-11-21) — "performance won't match native SSD".

**Persistence & idle/auto-stop.** `sleepAfter` default `"10m"` (string like `"30s"`, `"5m"`, or seconds). `keepAlive: true` sends a heartbeat every 30 s and prevents sleep until `destroy()`. "Cloudflare doesn't enforce a fixed maximum runtime" but "Host server restarts may terminate instances unpredictably." Sleeping containers "still count" toward account limits (lifecycle doc). DO storage (SQLite) survives; container disk does not.

**Networking.**
- Ingress: only HTTP via the Worker. `exposePort(port, {hostname})` → `https://{port}-sandbox-{id}-{token}.{yourdomain}` (needs wildcard DNS + `proxyToSandbox()`); deprecated in favor of `sandbox.tunnels.get(port)` → random `*.trycloudflare.com` quick tunnel (unauthenticated) or named tunnel `<name>.<your-zone>` (needs `CLOUDFLARE_API_TOKEN`). "end-users cannot make non-HTTP TCP or UDP requests to a Container instance."
- Egress: on by default. `enableInternet = false` blocks everything except what `allowedHosts` / outbound handlers allow ("Only ports 80, 443, and DNS are available, and DNS queries use Cloudflare's DNS servers"). `allowedHosts` (deny-by-default allowlist) / `deniedHosts` accept hostnames, IPs, CIDRs and `*` globs; `enableInternet` is read at start, handler/policy changes apply live. `MySandbox.outbound = async (request, env, ctx) => ...` intercepts all HTTP(S) (needs `interceptHttps = true` on Containers; the sandbox image trusts `/etc/cloudflare/certs/cloudflare-containers-ca.crt`); `outboundByHost = { 'api.anthropic.com': handler }` maps hosts to Worker functions (credential injection, calling bindings). Must `export { ContainerProxy }` from the Worker entrypoint. Non-HTTP egress (ssh://, raw TCP) is **not** covered by handlers — with `enableInternet=false` only 80/443/DNS exist, so git over HTTPS only.
- Egress is billed per GB (see Pricing); LLM/GitHub traffic for 10 agents is far below the 1 TB NA/EU allotment.

**Secrets model.** Worker secrets (`wrangler secret put X`) or Secrets Store bindings live in `env`; pass to the sandbox via `setEnvVars({...})` (sandbox-wide), `createSession({env})`, `exec(cmd,{env})` (per-command, highest precedence), or Dockerfile `ENV` (lowest). Recommended pattern (used by the official `examples/claude-code`): put a **placeholder** in the container env (`ANTHROPIC_API_KEY: 'proxy-injected'`) and have `outboundByHost['api.anthropic.com']` swap in `env.ANTHROPIC_API_KEY` — "the real secret is injected by the outbound handler above and never enters the container."

**Limits (containers/platform-details/limits, 2026-08).**
| Instance type | vCPU | Memory | Disk |
|---|---|---|---|
| lite (default) | 1/16 | 256 MiB | 2 GB |
| basic | 1/4 | 1 GiB | 4 GB |
| standard-1 | 1/2 | 4 GiB | 8 GB |
| standard-2 | 1 | 6 GiB | 12 GB |
| standard-3 | 2 | 8 GiB | 16 GB |
| standard-4 | 4 | 12 GiB | 20 GB |
Custom types (`instance_type: {vcpu, memory_mib, disk_mb}`, GA 2026-01-05): 1–4 vCPU, ≤12 GiB, ≤20 GB disk, **minimum 3 GiB memory per vCPU**, max 2 GB disk per GiB memory (so a "2 vCPU / 4 GiB" box is not allowed — 2 vCPU needs ≥6 GiB). Account-wide concurrent: **1,500 vCPU / 6 TiB memory / 30 TB disk** (raised 15× on 2026-02-25; GA blog: "15,000 lite, 6,000 basic, 1,000+ larger instances"). `max_instances` per container app defaults to 20 (per wrangler config docs). Image size ≤ the instance's disk; 50 GB total image storage per account (`wrangler containers delete` to reclaim). Workers subrequest cap 1,000/request on Paid — each HTTP-transport SDK call is a subrequest (use RPC transport). No GPUs.

**Regions.** "Region: Earth" by default; `constraints.regions` in `[ENAM, WNAM, EEUR, WEUR, APAC, SAM, ME, OC, AFR]` and `constraints.jurisdiction` `eu` | `fedramp` (2026-04-05). ME/OC/AFR cannot be used exclusively.

**Rollouts.** `wrangler deploy` uploads Worker, builds+pushes image (only changed layers), then starts a rollout; `rollout_step_percentage` default `[10,100]` when `max_instances ≥ 2`; `--containers-rollout=immediate` for breaking package/image cutovers. Replacement = SIGTERM, SIGKILL after 15 min. Live agent processes die on rollout — "Expect a short cutover window."

**OSS / self-host.** SDK, container image and control server are Apache-2.0 on GitHub (monorepo `packages/sandbox`, `packages/sandbox-container`, `bridge`, `devin`, examples). The runtime (VM scheduler, registry, DO) is proprietary Cloudflare; **no self-host**. Local dev works via `wrangler dev` + Docker (Miniflare auto-grants FUSE since 2026-08-20). Debug: `wrangler containers ssh` / SSH ProxyCommand (2026-03/05), `wrangler containers instances`.

## API / SDK (concrete)
SDK language: **TypeScript/JavaScript only**, and only from inside a Worker/DO (no REST API for sandboxes; the `bridge/` package exposes an HTTP API you deploy yourself). Auth = your Cloudflare account via `wrangler login`; the sandbox is addressed by `getSandbox(env.Sandbox, id)` from your Worker.

**wrangler.jsonc**
```jsonc
{
  "name": "pi-factory", "main": "src/index.ts",
  "compatibility_date": "2026-08-25", "compatibility_flags": ["nodejs_compat"],
  "containers": [{
    "class_name": "Sandbox", "image": "./Dockerfile",
    "instance_type": "standard-3",            // or {"vcpu":2,"memory_mib":6144,"disk_mb":8000}
    "max_instances": 12,
    "constraints": { "regions": ["ENAM","WNAM"] }
  }],
  "durable_objects": { "bindings": [{ "class_name": "Sandbox", "name": "Sandbox" }] },
  "migrations": [{ "new_sqlite_classes": ["Sandbox"], "tag": "v1" }],
  "r2_buckets": [{ "binding": "BACKUP_BUCKET", "bucket_name": "pi-backups" }],
  "vars": { "BACKUP_BUCKET_NAME": "pi-backups", "CLOUDFLARE_ACCOUNT_ID": "<id>" }
}
```
**Dockerfile** (image tag must match the npm version)
```dockerfile
FROM docker.io/cloudflare/sandbox:0.12.8          # Ubuntu 22.04, Node 24, Bun, git, curl, jq
RUN npm install -g @earendil-works/pi-coding-agent
ENV COMMAND_TIMEOUT_MS=1800000
# do NOT override ENTRYPOINT (/container-server/sandbox); EXPOSE only needed for wrangler dev
```
**Worker (stable 0.12.x)**
```ts
import { Sandbox as Base, getSandbox, ContainerProxy } from '@cloudflare/sandbox';
export { ContainerProxy };
export class Sandbox extends Base<Env> {
  interceptHttps = true;
  enableInternet = false;
  allowedHosts = ['github.com', 'api.github.com', 'api.anthropic.com', 'registry.npmjs.org', '*.npmjs.org'];
  sleepAfter = '30m';
}
Sandbox.outboundByHost = {
  'api.anthropic.com': async (req, env) => {
    const h = new Headers(req.headers); h.set('x-api-key', env.ANTHROPIC_API_KEY);
    const u = new URL(req.url);
    return fetch(`https://api.anthropic.com${u.pathname}${u.search}`, { method: req.method, headers: h, body: req.body });
  },
};
export default {
  async fetch(req: Request, env: Env) {
    const sb = getSandbox(env.Sandbox, 'task-42', { sleepAfter: '30m', normalizeId: true });
    await sb.setEnvVars({ ANTHROPIC_API_KEY: 'proxy-injected', GITHUB_TOKEN: env.GH_TOKEN_RO });
    await sb.gitCheckout('https://github.com/me/repo', { branch: 'main', depth: 1, targetDir: '/workspace/repo' });
    await sb.writeFile('/root/.pi/agent/settings.json', JSON.stringify({ /* pi settings */ }));
    // buffered
    const r = await sb.exec('pi -p "fix the failing test" --mode json', { cwd: '/workspace/repo', timeout: 1_800_000 });
    // streaming
    const stream = await sb.execStream('pi -p "..." --mode json', { cwd: '/workspace/repo' });
    for await (const ev of stream) { /* ev.type: stdout|stderr|complete */ }
    // background
    const p = await sb.startProcess('pi --mode rpc', { cwd: '/workspace/repo' });
    await p.waitForLog(/ready/); await sb.streamProcessLogs(p.id); await sb.killProcess(p.id, 'SIGTERM');
    const diff = (await sb.exec('git diff', { cwd: '/workspace/repo' })).stdout;
    const backup = await sb.createBackup({ dir: '/workspace/repo', ttl: 86400, useGitignore: true });
    await sb.destroy();                                   // frees resources immediately
    return Response.json({ exit: r.exitCode, diff, backup });
  }
};
```
Other stable methods: `readFile(path,{encoding:'none'})` → stream, `mkdir`, `deleteFile`, `renameFile`, `moveFile`, `exists`, `listProcesses`, `killAllProcesses`, `getProcessLogs`, `createSession({id,env,cwd,commandTimeoutMs})` (own shell state; `enableDefaultSession:false` recommended), `createCodeContext({language:'python'|'javascript'|'typescript'})` + `runCode(code,{context})`, `watch(dir)`, `terminal(request)` (WebSocket PTY), `wsConnect`, `mountBucket`, `tunnels.get/list/destroy`, `exposePort/unexposePort/getExposedPorts` (deprecated), `restoreBackup(handle)`. Options on `getSandbox`: `enableDefaultSession`, `keepAlive`, `sleepAfter`, `containerTimeouts`, `normalizeId`.

**1.0 preview (`@cloudflare/sandbox@next`)** — argv-based, returns a process handle:
```ts
const p = await sandbox.exec(['pi', '-p', task, '--mode', 'json'], { cwd: '/workspace/repo', env: {...}, timeout: 1_800_000 });
for await (const line of p.logs({ follow: true })) { ... }
await p.waitForExit(); p.exitCode;
const out = await p.output({ encoding: 'utf8' });    // may truncate
await p.kill(15);
const git = await sandbox.exec(['git','clone','--depth','1',url,'/workspace/repo']); await git.waitForExit();
const term = await sandbox.createTerminal(); term.connect(request);       // PTY
const sb = withInterpreter(sandbox); await sb.interpreter.runCode(...)     // interpreter as extension
```
Removed on 1.0: `gitCheckout`, sessions, `startProcess/execStream`, string signals, process stdin (use terminals), `exposePort`, HTTP/WS transport.

**CLI.** `npm create cloudflare@latest -- app --template=cloudflare/sandbox-sdk/examples/claude-code`; `npx wrangler dev` (needs Docker); `npx wrangler deploy [--containers-rollout=immediate]`; `wrangler secret put ANTHROPIC_API_KEY`; `wrangler containers list|instances|delete|ssh`; `wrangler r2 bucket create pi-backups`.

## Workflow: end to end (for our factory)
1. **Image**: `FROM docker.io/cloudflare/sandbox:0.12.8` (Node 24 already present) + `RUN npm i -g @earendil-works/pi-coding-agent` + any toolchains (pnpm, python). Optional: `--build-arg NODE_VERSION=…` if building the base yourself. Deploy once with `wrangler deploy`; image is pushed to Cloudflare's registry and pre-fetched globally.
2. **Orchestrator**: a Worker (or a Workflow / Queue consumer) receives a batch of tasks and, per task, does `getSandbox(env.Sandbox, `task-${id}`)` — 10 distinct IDs = 10 VMs. Set `max_instances ≥ 10` and `instance_type: "standard-3"` (2 vCPU/8 GiB) or custom `{vcpu:2, memory_mib:6144, disk_mb:8000}`.
3. **Provision per sandbox**: `setEnvVars` with placeholder LLM key + read-only GitHub token; `gitCheckout(repo,{depth:1,targetDir})` (or `exec(['git','clone',…])` on 1.0); write `~/.pi/agent/settings.json` / `auth.json` via `writeFile`. Alternatively `restoreBackup()` of a pre-warmed `/workspace` (deps installed) — ~2 s.
4. **Run pi**: `execStream('pi -p "<task>" --mode json', {cwd, timeout})` and stream JSON events back to the orchestrator (RPC transport to avoid the 1,000-subrequest cap; or `keepAlive:true` for long runs). Interactive/HITL runs: `startProcess('pi --mode rpc')` and bridge stdin/stdout (stable) or a PTY `createTerminal()` (1.0).
5. **Collect**: `exec('git diff')`, `exec('git push origin HEAD:pi/task-42')` via HTTPS with the injected token, or `readFile` of `~/.pi/agent/sessions/*.jsonl` and push to R2 (`mountBucket` or backup API) for audit.
6. **Teardown**: `sandbox.destroy()` immediately (don't wait for `sleepAfter`), keeping a `createBackup()` handle if you want resumability (3-day default TTL; re-restore on wake).
7. **Parallelism**: 10 concurrent standard-3 = 20 vCPU / 80 GiB — negligible vs the 1,500 vCPU account ceiling. Worker CPU time is tiny; the DO just proxies.

## Pricing
Source: https://developers.cloudflare.com/containers/pricing/ (page updated 2026-04-21, fetched 2026-08-26). Requires **Workers Paid $5/mo**; no free tier. Billed per 10 ms while the instance is running (from first request/start until sleep).
- Memory (provisioned): 25 GiB-h/mo included, then **$0.0000025/GiB-s = $0.009/GiB-h**
- CPU (**active usage only**): 375 vCPU-min/mo included, then **$0.000020/vCPU-s = $0.072/vCPU-h**
- Disk (provisioned): 200 GB-h/mo included, then **$0.00000007/GB-s = $0.000252/GB-h**
- Egress: NA/EU $0.025/GB (1 TB included); Oceania/KR/TW $0.05/GB (500 GB incl.); elsewhere $0.04/GB (500 GB incl.)
- Plus Workers requests and Durable Object requests/duration (standard Workers Paid meters; small for this workload) and optional Workers Logs.

**Estimate: 10 sandboxes × 2 vCPU × 4 h/day × 22 days = 880 instance-hours/month.** Note a 2 vCPU / 4 GiB shape does not exist (min 3 GiB/vCPU), so two realistic shapes:

*A. `standard-3` (2 vCPU, 8 GiB, 16 GB disk)*
- Memory: 880 h × 8 GiB = 7,040 GiB-h − 25 = 7,015 × $0.009 = **$63.14**
- Disk: 880 × 16 GB = 14,080 GB-h − 200 = 13,880 × $0.000252 = **$3.50**
- CPU @100% busy: 880 × 2 = 1,760 vCPU-h = 105,600 vCPU-min − 375 = 105,225 × 60 × $0.00002 = **$126.27**
- CPU @25% busy (agent mostly waiting on the LLM): 26,400 − 375 = 26,025 vCPU-min × $0.0012 = **$31.23**
- Plan: **$5.00**; egress/DO/Workers: ≈$0–3
- **Total ≈ $103/mo (25% CPU) … $198/mo (100% CPU)**

*B. custom `{vcpu:2, memory_mib:6144, disk_mb:8000}`*
- Memory: 880 × 6 = 5,280 − 25 = 5,255 × $0.009 = $47.30; Disk: 7,040 − 200 = 6,840 × $0.000252 = $1.72; CPU $31.23–$126.27; plan $5
- **Total ≈ $85/mo (25% CPU) … $180/mo (100% CPU)**

Idle awake time (e.g. a 10-minute `sleepAfter` tail after each run) costs memory+disk only: standard-3 ≈ $0.076/h. Sleeping = $0. Backups: R2 storage $0.015/GB-mo (first 10 GB free). For comparison, a HN thread (Oct 2025) computed ~$158/mo for one always-on container and called a 1 vCPU/1 GiB continuous box ">$58/mo … Hetzner 35+ times cheaper"; the 2025-11 switch to active-CPU billing cut the CPU part for bursty agents but memory is still provisioned-hours. Northflank's 2026 comparison lists Cloudflare at "$0.072/vCPU-hr (active CPU only) + $5/mo" and warns to "model the full cost across all billing dimensions."

## Notable techniques worth stealing
- **Egress-proxy credential injection**: keep `ANTHROPIC_API_KEY`/GitHub tokens in the orchestrator, give the agent a sentinel value, rewrite headers at the proxy (`outboundByHost`). Also gives per-host allowlists and a natural audit log of every LLM/GitHub call.
- **Deny-by-default allowlist with globs/CIDRs** enforced at the VM boundary, changeable live without restart.
- **Directory backups as squashfs + CoW overlay restore** (2 s restore of a warmed `node_modules`) instead of full VM snapshots — cheap to store in object storage, portable, serializable handles.
- **Lazy DO-per-sandbox addressing**: `getSandbox(ns, id)` is free until first op; ID = task hash gives idempotent "one VM per task" semantics and automatic routing to the same instance from anywhere.
- **`waitForPort` / `waitForLog` process handles** and streaming logs with cursors (`logs({since, follow})`) — a good shape for an agent-runner API.
- Official examples show exactly our pattern: `examples/claude-code` (clone → run `claude --print` → return `git diff`), `examples/opencode`, `examples/codex`, `examples/git-repo-per-sandbox`, `examples/time-machine` (checkpoints).

## Weaknesses / open questions / risks
- **API churn**: 0.12 → 1.0 removes `gitCheckout`, sessions, `startProcess`, `execStream`, `exposePort`, stdin; image tag must match npm version exactly; rollouts kill running agents (SIGTERM → SIGKILL ≤15 min).
- **No memory snapshot / fork / pause**; disk is wiped on sleep; backup restore is a FUSE overlay that disappears on sleep. Long-lived agent state must be re-hydrated by us.
- **No max-runtime guarantee**: hosts can restart instances "unpredictably"; DO ↔ container can be in different locations.
- **Control plane is Workers-only**: no REST/Python/Go SDK; you must write a Worker (TypeScript) as the orchestrator, and every sandbox op traverses Worker→DO→container (subrequest limits on HTTP transport).
- **Cost**: memory is billed on provisioned hours even while the agent waits on the LLM; ~$85–200/mo for our load, which is competitive with Firecracker sandboxes but 3–5× a Hetzner box. Custom shapes force ≥3 GiB/vCPU.
- **Egress control is HTTP-only**: no SSH git (`enableInternet=false` leaves only 80/443/DNS); TLS interception requires trusting Cloudflare's CA in the container (fine for the official image, pi/Node honour it, but custom tools may pin certs).
- Ingress only via HTTP (preview URLs/tunnels); quick tunnels are unauthenticated public URLs.
- Docker required locally for `wrangler dev`/deploy from a Dockerfile; first deploy several minutes.
- Open: exact hypervisor; whether DO duration billing while a container runs is material; how `sleepAfter` interacts with a long-running `exec` (docs say activity resets the timer; `keepAlive` exists as a safety valve); root vs non-root user in the base image (Dockerfile has `/home/user`, not verified).

## Fit for our agentic stack
**pi preinstallable: yes, trivially.** The default image already ships **Node 24** (Dockerfile `ARG NODE_VERSION=24`, `node:24-slim` runtime; docs' "Node 20" refers to the old 0.7.0 tag) plus Bun and git, so `FROM docker.io/cloudflare/sandbox:0.12.8` + `RUN npm install -g @earendil-works/pi-coding-agent` is the whole image. Write `~/.pi/agent/settings.json` and `auth.json` (or use env `ANTHROPIC_API_KEY` with the proxy-injection trick so the real key never lands in the VM) via `writeFile`, run `pi -p … --mode json` with `execStream`, or `pi --mode rpc` as a background process. Sessions JSONL can be pushed to R2 with `mountBucket` or the backup API.

**Verdict:** Strong fit if we are willing to write the orchestrator as a Cloudflare Worker (TypeScript — same language as pi) and accept ephemeral disks. Its egress-proxy secret injection is the best secrets story of the providers surveyed, GA status and 1,500-vCPU headroom remove scaling worries, and cost (~$85–200/mo for 10 agents × 4 h/day) is reasonable with active-CPU billing. Main drawbacks: no snapshot/fork of running state, imminent 1.0 API break (build against `@next` now), and total platform lock-in (Worker-only control plane, no self-host). Recommend as a top-2 candidate alongside a Firecracker-based provider if we need pause/resume/fork.

## Related resources mentioned
- GA blog "Agents have their own computers with Sandboxes GA" — https://blog.cloudflare.com/sandbox-ga/ (2026-04-13)
- Changelog GA post — https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/
- Sandbox changelog — https://developers.cloudflare.com/changelog/product/sandbox/ (1.0 preview 2026-08-07; Devin Outposts 2026-07-21; deprecations 2026-06-09)
- Containers changelog — https://developers.cloudflare.com/changelog/product/containers/
- 1.0 preview docs — https://developers.cloudflare.com/sandbox/1-0-preview/ ; migrate guide …/1-0-preview/migrate/
- Tutorials: Run Claude Code on a Sandbox (…/sandbox/tutorials/claude-code/), Devin Outposts, Claude Managed Agents, OpenAI Agents
- Examples: https://github.com/cloudflare/sandbox-sdk/tree/main/examples (claude-code, opencode, codex, git-repo-per-sandbox, time-machine, s3-mount)
- Docker Hub images: `cloudflare/sandbox:<ver>[-python|-opencode|-musl]` (DOCKER_README.md in repo)
- Cloudflare VibeSDK — https://github.com/cloudflare/vibesdk (open-source vibe-coding platform; per 2026 README uses Dynamic Workers + DO workspaces + "Cloudflare Artifacts" rather than Sandbox SDK)
- `@cloudflare/computer` early preview (2026-08-03) and `cloudflare/cloudflare-os` (2026-08-05, self-hostable agent workspace) — via lushbinary/nerdleveltech/explainx summaries, unverified
- HN: "Cloudflare Sandbox SDK" https://news.ycombinator.com/item?id=45610523 ; pricing subthread id=45611237
- Northflank AI sandbox pricing comparison — https://northflank.com/blog/ai-sandbox-pricing ; InfoQ GA coverage — https://www.infoq.com/news/2026/04/cloudflare-sandboxes-ga/
- Kent C. Dodds, "Simplifying Containers with Cloudflare Sandboxes" — https://kentcdodds.com/blog/simplifying-containers-with-cloudflare-sandboxes

## Key quotes / references
- "Each container instance runs inside its own VM, which provides strong isolation from other workloads running on Cloudflare's network." — containers/platform-details/architecture
- "Container cold starts can often be in the 1-3 second range, but this is dependent on image size and code execution time, among other factors." — same
- "All disk is ephemeral. When a Container instance goes to sleep, the next time it is started, it will have a fresh disk as defined by its container image." — containers/faq
- "Memory and disk usage are based on the provisioned resources for the instance type you select, while CPU usage is based on active usage only." — containers/pricing
- "When `enableInternet` is `false`, only traffic you explicitly allow … can leave the sandbox. Only ports 80, 443, and DNS are available, and DNS queries use Cloudflare's DNS servers." — sandbox/guides/outbound-traffic
- "the real secret is injected by the outbound handler above and never enters the container." — examples/claude-code/src/index.ts
- "the FUSE mount is lost when the sandbox sleeps or the container restarts" — sandbox/guides/backup-restore
- "Minimum 3 GiB memory per vCPU"; "6 TiB / 1,500 vCPU / 30 TB" concurrent account limits; "50 GB" image storage — containers/platform-details/limits
- "Published sandbox images include Node.js 24 by default." — DOCKER_README.md
- "Sandbox SDK 1.0 … sandbox.exec() takes an argument list, returns when the process starts, and gives you a handle for output … RPC as the only transport." — changelog 2026-08-07

**Gaps:** Could not fetch the HN pricing subthread (429) or web.archive; hypervisor/runtime identity not documented; Durable Object duration cost while a container runs not quantified; whether `sleepAfter` timer is reset by a still-running `exec` (docs imply activity-based) not verified by test; base-image default user (root vs `user`) not verified; VibeSDK's current relationship to Sandbox SDK taken from search snippets only; `@cloudflare/computer` / cloudflare-os details from third-party summaries only.
