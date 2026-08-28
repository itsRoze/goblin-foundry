# E2B (e2b.dev)
- **URL:** https://e2b.dev — docs https://docs.e2b.dev (all `e2b.dev/docs/*` URLs now 308-redirect there; machine index at https://docs.e2b.dev/llms.txt)
- **Type:** sandbox
- **Author/Org:** FoundryLabs, Inc. (E2B), SF/Prague. ~25 people, $32M raised ($21M Series A Jul 2025) per rywalker.com/research/e2b
- **Researched:** 2026-08-26
- **Status/maturity:** GA, commercial. GitHub (checked 2026-08-26 via `gh api`): `e2b-dev/E2B` 13,559 stars, Apache-2.0, pushed 2026-08-26; `e2b-dev/infra` 1,343 stars, Apache-2.0, pushed 2026-08-26; `e2b-dev/code-interpreter` 2,384 stars, Apache-2.0; `e2b-dev/desktop` 1,457 stars, Apache-2.0. Latest releases: `e2b@2.46.0` (JS), `@e2b/python-sdk@2.46.0`, `@e2b/cli@2.18.0` — all 2026-08-25. Weekly changelog cadence (entries dated Jul 14/21/27, Aug 3/10/17/24 2026). Some features still private beta: Volumes, Workload identity, per-host request transforms.

## One-paragraph summary
E2B is the "reference" hosted AI-agent sandbox: each sandbox is a Firecracker microVM (on GCP, `us-west1` default; EU/APAC on Pro by request) booted from a template snapshot in ~80–150 ms, controlled through an in-VM daemon (`envd`) via JS/TS and Python SDKs plus a CLI. It has the most complete state model of the hosted providers — pause/resume with full memory, filesystem-only snapshots, durable snapshots (one-to-many), in-place fork (up to 100 clones per call), auto-pause/auto-resume — plus per-sandbox egress allow/deny lists by CIDR or hostname, public HTTPS URLs per port, a Template SDK (Dockerfile-free builds with a captured "already running" start command), native `sandbox.git.*` helpers, lifecycle webhooks, and official prebuilt templates for coding agents, including a first-party **`pi` template and guide** (`docs.e2b.dev/agents/pi`). Pricing is per-second on allocated vCPU/RAM ($0.0504/vCPU-h, $0.0162/GiB-h), with a $150/mo Pro plan gate for >1 h continuous sessions, >20 concurrent sandboxes and custom CPU/RAM. Infra is Apache-2.0 and self-hostable on GCP (AWS beta) via Terraform/Nomad, but the footprint is heavy (≥24 CPUs, 2.5 TB SSD).

## Core ideas / thesis
- "Run untrusted AI-generated code / agents in a hardware-isolated microVM, not a container" — Firecracker (~50k LoC Rust vs QEMU ~2M; <5 MB overhead/VM; ~125 ms boot) chosen for security + speed (e2b.dev/blog/firecracker-vs-qemu, 2025-03-03).
- Templates are **snapshots, not images**: the build runs your start command, waits for readiness, then snapshots memory+disk, so sandboxes spawn with processes already running ("load the sandbox in ~80ms any time later with all the processes already running" — docs/template/how-it-works).
- Everything is a snapshot: pause = snapshot; fork = snapshot + N restores; templates = snapshots. Billing stops the instant a sandbox is not running.
- Agent-native positioning: prebuilt templates + guides for Claude Code, Codex, OpenCode, Droid, Amp, Devin, Hermes, **pi**, etc. (`docs.e2b.dev/agents/*`), an MCP gateway, and "Coding agents" use-case page ("run many sandboxes in parallel, each with its own agent on a separate task").

## Architecture & mechanics
- **Isolation:** Firecracker microVM per sandbox, KVM on GCP hosts; orchestrated by Nomad/Consul (`e2b-dev/infra`: orchestrator, API, `envd` in-VM control daemon, template builder, PostgreSQL, ClickHouse for metrics). Sandboxes run as user `user` with home `/home/user`; `sudo` available in base image. No GPU (Firecracker has no PCIe passthrough).
- **Cold start:** template restore ~80 ms (docs), ~150 ms same-region (rywalker); third parties quote 300–800 ms end-to-end including API round trip (morphllm). Sandbox creation rate limit: 1/s Hobby, 5/s Pro.
- **Default resources:** 2 vCPU / 512 MiB RAM (docs/faq/calculate-sandbox-price). CPU/RAM are set **per template at build time** (`cpuCount`/`memoryMB`), not per `Sandbox.create()`. Max 8 vCPU / 8 GiB on Hobby and Pro ("8+" on Pro by emailing support). Disk: 10 GiB Hobby, 20+ GiB Pro; "Disk size is not a per-sandbox setting… there is no disk-size parameter, neither on the template build nor on `Sandbox.create`" — determined by plan.
- **Timeouts:** default 5 min; `timeoutMs`/`timeout` at create, `setTimeout()` resets it at runtime; `lifecycle.onTimeout: 'kill' | 'pause' | {action:'pause', keepMemory:false}`; `lifecycle.autoResume: true` wakes a paused sandbox on any SDK call or HTTP hit to its public URL (resumed with ≥5 min timeout). **Max continuous runtime 1 h (Hobby) / 24 h (Pro)**; "Limits reset after pausing and resuming."
- **Pause/resume (GA):** `sandbox.pause()` saves filesystem + memory (running processes, variables). Resume via `Sandbox.connect(id)` — "same state it was in when you paused it". Pause ≈ 4 s per GiB RAM; resume ≈ 1 s. `pause({keepMemory:false})` = filesystem-only snapshot, resume is a reboot (faster, drops processes; also the documented way to pick up newer `envd`). Paused sandboxes: kept indefinitely, not billed, do **not** count toward concurrency, only deleted by explicit `kill`. External connections (WebSocket/PTY/command streams) drop on pause.
- **Snapshots (durable, one-to-many):** `sandbox.createSnapshot()` / `Sandbox.createSnapshot(id)` → `snapshotId`; `Sandbox.create(snapshotId)` spawns many; `Sandbox.listSnapshots()`, `Sandbox.deleteSnapshot()`. Original is briefly paused/resumed. Needs envd ≥ v0.5.0. CLI: `e2b sandbox snapshot create <id>` (alias `snap`), added 2026-08-24.
- **Fork (added 2026-07-21):** `sandbox.fork({count: N, timeoutMs})` — up to 100 forks per call, snapshot taken once; each fork is an independent sandbox with its own ID/timeout; per-fork errors returned in the list rather than thrown. Pause duration "scales with the amount of disk changes since the last snapshot".
- **Persistence options:** pause (1:1), snapshots (1:N), templates (build-time), **Volumes** (private beta; `Volume.create('my-volume')` then `Sandbox.create({volumeMounts:{'/mnt/my-data': volume}})`, shareable across sandboxes), cloud-bucket mounts (docs/storage/cloud-buckets, Archil).
- **Networking:** every sandbox gets `https://<port>-<sandboxId>.e2b.app` via `sandbox.getHost(port)`; optional auth on public URL (docs/network/restrict-public-access), custom domains, `maskRequestHost`. Egress: on by default; `allowInternetAccess:false` = deny all; `network.allowOut` / `network.denyOut` accept IPs, CIDRs, hostnames and wildcards (`*.github.com`); hostname filtering works for HTTP Host header/HTTPS SNI only (UDP/QUIC needs CIDR); allow beats deny; `8.8.8.8` DNS auto-allowed when domains are used; `sandbox.updateNetwork()` replaces rules at runtime; per-host request transforms (beta) can inject headers (e.g. workload-identity tokens) at the egress proxy; bring-your-own SOCKS5 egress proxy (2026-08-24). **No static egress IPs** on any plan; traffic leaves from rotating GCP IPs (`us-west1`; EU `europe-west1`, APAC `asia-southeast1` on Pro by request).
- **Secrets model:** plain `envs` at create (global for the sandbox lifetime) or per-command `envs` ("scoped to the command but are not private in the OS"); template `.setEnvs()` bakes them into the snapshot (avoid for secrets). `sandbox.git.clone(url,{username,password})` strips creds from the remote URL by default; `git.dangerouslyAuthenticate()` stores a credential helper on disk (warned). **Workload identity** (private beta): `iam.tokens.<name> = Secret.iamToken({audience, tokenType:'JWT-SVID'})` mints short-lived SPIFFE JWTs (`spiffe://id.e2b.dev/<project>/<sandbox>/<execution>`) that AWS STS etc. can federate via OIDC (`https://id.e2b.dev/.well-known/openid-configuration`); tokens are injected by the egress proxy so the sandbox never sees the real credential. Sandbox controller (`envd`) is protected by a per-sandbox access token (`secure: true` default since SDK v2). Access tokens for the API were retired 2026-08-03; everything uses `E2B_API_KEY`.
- **Limits (docs/billing, 2026-08-26):** Hobby: $0, $100 one-time credit, 8 vCPU/8 GiB max, 10 GiB disk, 1 h continuous, 20 concurrent, 20 concurrent builds, 1 sandbox/s. Pro: $150/mo, 8+ vCPU/8+ GiB, 20+ GiB disk, 24 h continuous, 100 concurrent (add-on: +500 slots for $500/mo, up to 1,100), 20 builds, 5 sandboxes/s. Template build: ≤1 h, unlimited number of templates.
- **Observability:** `getInfo()` (cpuCount, memoryMB, state), `getMetrics()`, sandbox logs API, lifecycle webhooks (`sandbox.lifecycle.created|paused|killed` carrying `execution.{vcpu_count,memory_mb,execution_time}`), OTel export, `Sandbox.list({query:{state:['running'], metadata}})` with server-side filters.
- **OSS/self-host:** `e2b-dev/infra` (Apache-2.0) deploys with Terraform + Packer + Nomad/Consul; GCP supported, AWS "beta"/"fully supported" depending on doc; Azure/bare Linux not supported. Requirements listed in `self-host.md`: Terraform 1.7.5, Packer, Go, Docker, Cloudflare-managed domain, PostgreSQL, quota of ≥24 CPUs and ≥2,500 GB persistent SSD. BYOC (your AWS/GCP account, E2B-managed) is Enterprise-only.

## API / SDK (concrete)
- **Languages:** JS/TS (`npm i e2b`, Node/Bun/Deno/browser — "cross-runtime web platform object detection" added Aug 2026), Python (`pip install e2b`; transport rewritten on Rust `pyqwest`, Aug 2026), CLI (`npm i -g @e2b/cli`). Specialised SDKs: `@e2b/code-interpreter` / `e2b-code-interpreter` (adds `runCode()` Jupyter-style contexts, charts) — we don't need it; `@e2b/desktop` / `e2b-desktop` (Xfce desktop, VNC stream, click/type API) — irrelevant for pi. REST API documented at docs/api-reference (`create-sandbox`, `fork-sandbox`, `create-snapshot`, `pause`, `resume`, `set-sandbox-timeout`, `update-sandbox-network`, envd process/filesystem endpoints). Multi-connection client for multiple API keys (`docs/client`).
- **Auth:** `E2B_API_KEY` env var (from console.e2b.dev); `E2B_PROJECT_ID` / `--project` selects the project ("teams" renamed to projects Jul 2026). `e2b auth login`.

```ts
// template.ts — our pi image (Template SDK, no Dockerfile needed)
import { Template, waitForTimeout } from 'e2b'
export const template = Template()
  .fromNodeImage('24')                        // Node 24 base (pi needs Node>=24 or Bun)
  .aptInstall(['git', 'curl', 'ripgrep', 'jq'])
  .npmInstall('@earendil-works/pi-coding-agent@latest', { g: true })
  .setUser('user').setWorkdir('/home/user')
  .copy('pi-settings.json', '/home/user/.pi/agent/settings.json')   // non-secret config only
  .runCmd('git config --global user.name "factory-bot" && git config --global user.email bot@example.com')
// alternatives: Template().fromTemplate('pi')  (E2B's prebuilt pi template) | .fromDockerfile(str) | .fromImage('ghcr.io/me/pi:1', {registry creds})

// build.ts
import { Template, defaultBuildLogger } from 'e2b'
await Template.build(template, 'factory-pi', { cpuCount: 2, memoryMB: 4096, onBuildLogs: defaultBuildLogger() })
// Template.buildInBackground + Template.getBuildStatus for CI; tags via docs/template/tags
```

```ts
import { Sandbox } from 'e2b'
// create (all secrets via envs, egress locked to what pi needs)
const sbx = await Sandbox.create('factory-pi', {
  timeoutMs: 4 * 60 * 60 * 1000,               // needs Pro (>1h)
  envs: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!, GITHUB_TOKEN: process.env.GITHUB_TOKEN! },
  metadata: { task: 'issue-123', agent: 'pi' },
  lifecycle: { onTimeout: 'pause' },           // checkpoint instead of losing work
  network: {
    denyOut: ({ allTraffic }) => [allTraffic],
    allowOut: ['api.anthropic.com', 'github.com', '*.github.com', 'registry.npmjs.org', '*.npmjs.org', 'pypi.org', 'files.pythonhosted.org'],
  },
})
await sbx.git.clone('https://github.com/org/repo.git', { path: '/home/user/repo', username: 'x-access-token', password: process.env.GITHUB_TOKEN, depth: 1 })

// run pi headless, stream output; timeoutMs:0 = no per-command limit
const run = await sbx.commands.run(`cd /home/user/repo && pi -p --mode json "Fix issue #123"`, {
  timeoutMs: 0, cwd: '/home/user/repo', envs: { PI_TASK_ID: '123' },
  onStdout: d => process.stdout.write(d), onStderr: d => process.stderr.write(d),
})
// or detached: const h = await sbx.commands.run('pi -p "..." > /home/user/pi.log 2>&1', { background: true }); later Sandbox.connect(id) + sbx.commands.connect(h.pid) + h.wait()

// files
const diff = (await sbx.commands.run('cd /home/user/repo && git diff')).stdout
await sbx.files.write('/home/user/task.md', spec)                 // also files.write([{path,data},...])
const session = await sbx.files.read('/home/user/.pi/agent/sessions/<id>.jsonl')
const dl = await sbx.downloadUrl('/home/user/out.tar.gz')         // pre-signed URL; uploadUrl() likewise
await sbx.files.watchDir('/home/user/repo', ev => {...})

// expose a port
const url = `https://${sbx.getHost(3000)}`

// state
await sbx.pause()                                // full memory snapshot
const same = await Sandbox.connect(sbx.sandboxId) // resume
const snap = await sbx.createSnapshot()          // durable; Sandbox.create(snap.snapshotId)
const forks = await sbx.fork({ count: 5, timeoutMs: 3_600_000 })
await sbx.setTimeout(30 * 60 * 1000)
await sbx.kill()                                 // or Sandbox.kill(id)
```

Python mirrors 1:1 (`Sandbox.create("factory-pi", timeout=14400, envs={...}, network={"deny_out": lambda c: [c.all_traffic], "allow_out": [...]})`, `sbx.commands.run(cmd, on_stdout=..., timeout=0, background=True)`, `sbx.pause(keep_memory=False)`, `sbx.fork(count=5)`, `Template.build(t, "factory-pi", cpu_count=2, memory_mb=4096)`).

- **CLI:** `e2b sandbox create factory-pi` (alias `sbx`; attaches a terminal, kills on exit), `e2b sandbox list`, `e2b sandbox connect <id>`, `e2b sandbox exec <id> -- cmd` (flags `--user --cwd --env`), `e2b sandbox kill <id>|--all`, `e2b sandbox snapshot create|list|delete`, `e2b template init|build|list|delete`. The legacy `e2b.toml` + `e2b.Dockerfile` flow is deprecated (docs/migration/template-v2 renames them to `.old`; keep using Dockerfiles via `.fromDockerfile()`).
- **SSH:** no native SSH; documented recipe runs `websocat` bridging port 22 over the public URL (docs/sandbox/ssh-access). `sandbox.pty` exists for interactive TTY.

## Workflow: end to end (for our factory)
1. **Image:** Build `factory-pi` once with the Template SDK above (`cpuCount: 2, memoryMB: 4096`; a second template `factory-pi-8g` if some tasks need 8 GiB — RAM is per template). Or start from E2B's own `pi` template (`Template().fromTemplate('pi')`) and add our tooling. Bake non-secret `~/.pi/agent/settings.json`; never bake `auth.json` — pass `ANTHROPIC_API_KEY` (or provider keys) as `envs`. Optionally warm the repo: clone + `npm ci` in `runCmd`, then `git fetch` at run time; or keep a **snapshot** of a warmed sandbox and spawn from `snapshotId` (cache invalidated by rebuilding).
2. **Fan-out:** orchestrator (Node, on our side) does `Promise.all` over 10 × `Sandbox.create('factory-pi', {timeoutMs: 4h, envs, metadata:{task}, lifecycle:{onTimeout:'pause'}, network: allowlist})`. Respect 5 creates/s (Pro). Alternative: create one sandbox, clone + install deps, then `sbx.fork({count: 10})` — one snapshot, ten warm clones, each then `git checkout -b task-N` (cheap replacement for local worktrees).
3. **Run:** `sbx.commands.run('cd /home/user/repo && pi -p --mode json "<task>"', {timeoutMs: 0, onStdout})`; for robustness run it `background: true` with output redirected to a log file, store `{sandboxId, pid}` in our DB, and reconnect with `Sandbox.connect` + `commands.connect(pid)` if the orchestrator restarts.
4. **Collect:** `git diff`/`git format-patch` via `commands.run`, or have pi push a branch with `sbx.git.push(path, {username, password})`; pull `~/.pi/agent/sessions/*.jsonl` with `files.read` for audit; lifecycle webhook `sandbox.lifecycle.killed` gives exact run time/cost per task.
5. **Teardown:** `sbx.kill()` on success; on timeout the sandbox auto-pauses (free, keeps memory) so a human can `Sandbox.connect(id)` to inspect, then `kill`. Set a budget cap in console (`?tab=budget`).

## Pricing
Source: https://e2b.dev/pricing and https://docs.e2b.dev/billing, https://docs.e2b.dev/faq/calculate-sandbox-price (fetched 2026-08-26). Per-second, on **allocated** vCPU/RAM, only while running:
- vCPU $0.000014/s = **$0.0504/vCPU-h**; RAM $0.0000045/GiB-s = **$0.0162/GiB-h**; disk included (10 GiB Hobby / 20 GiB Pro); paused/killed = $0; snapshots/paused state not separately billed per docs (storage beyond plan "on request").
- Plans: Hobby $0 + $100 one-time credit (1 h max session, 20 concurrent, no custom CPU/RAM); **Pro $150/mo** (24 h sessions, 100 concurrent, custom CPU/RAM, EU/APAC); concurrency add-on +500 slots $500/mo; Enterprise custom (BYOC).

Our load: 10 sandboxes × 2 vCPU × 4 GiB × 4 h/day × 22 days = **880 sandbox-hours/month**.
- per sandbox-hour: 2 × $0.0504 + 4 × $0.0162 = $0.1008 + $0.0648 = **$0.1656**
- compute: 880 × $0.1656 = **$145.73**
- plan: Pro $150 (required: 4 h sessions > Hobby's 1 h cap, and custom RAM > 512 MiB default requires Pro per pricing page)
- **Total ≈ $296/month** (≈ $0.33 per agent-hour all-in). At 8 GiB: $0.2304/h × 880 = $202.75 + $150 = **≈ $353/month**. Idle time is billed (meter runs while pi waits on the LLM), so `onTimeout:'pause'` and killing promptly matter. Hobby-plan hack (pause/resume every <1 h to reset the limit, default 512 MiB RAM) is not viable for 4 GiB agents. Cross-check: beam.cloud computes $291 compute + $150 for 10 × 2 vCPU/4 GiB × 8 h × 22 d — consistent with our arithmetic.

## Notable techniques worth stealing
- **Snapshot-as-template:** run the start command at build time, wait for readiness (`waitForPort/URL/File/Timeout`), snapshot memory — sandboxes spawn with the process already running. For us: pre-warm pi (Node heap, compiled deps) so `pi -p` starts hot.
- **Fork-by-count** (`fork({count:N})`) with per-item error results instead of throw — one warm environment → N task workers.
- **Lifecycle object** (`onTimeout: pause|kill`, `autoResume`, `keepMemory`) as a single declarative policy; auto-resume on HTTP or SDK activity.
- **Filesystem-only pause** as a cheap "workspace persistence" tier that also lets long-lived sandboxes pick up newer agent daemon versions.
- **Egress allow/deny by hostname with a selector-callback API** (`denyOut: ({allTraffic}) => [allTraffic]`), plus proxy-side secret injection (workload identity placeholders `${e2b.identity.tokens.x}` replaced at the egress proxy) — secrets never enter the VM.
- **Cost attribution via terminal lifecycle events** carrying `vcpu_count, memory_mb, execution_time`.
- Reconnect pattern for detached jobs: persist `{sandboxId,pid}`, redirect output to a file, `commands.connect(pid)`.

## Weaknesses / open questions / risks
- **$150/mo Pro gate** just to exceed 1 h sessions / 512 MiB RAM; usage fees on top ("draw consistent developer criticism" — rywalker). For our scale the plan fee is ~50% of the bill.
- **RAM/CPU fixed per template**, not per create — need a template per size class. Disk not configurable (10/20 GiB), no bigger disk without support; large monorepos + node_modules could pinch.
- **Idle billing**: pi spends most wall-clock waiting for the model; still billed at full allocation.
- **Pause cost scales with RAM** (~4 s/GiB → ~16 s for 4 GiB) and drops all live streams; fork pauses the original too.
- **Hostname egress rules are HTTP/HTTPS only** (SNI/Host); QUIC/other protocols need CIDR rules; no static egress IPs (GitHub allowlisting by IP impossible without BYO proxy).
- **Secrets are plain env vars inside the VM**; pi (and anything it runs) can read them. Workload identity is private beta and aimed at cloud STS, not LLM API keys.
- **Region:** default `us-west1` only; EU/APAC by support ticket on Pro.
- **Self-hosting is heavy** (Nomad/Consul, Terraform, ≥24 CPUs, 2.5 TB SSD, GCP-first) — not realistic for a solo dev; treat OSS as escape-hatch/licensing comfort, not a plan.
- Fast-moving API (weekly changelog; access-token auth removed Aug 2026; template v1/e2b.toml deprecated) — pin SDK versions.
- Open questions: whether snapshot storage beyond plan disk is ever charged (docs say included / "on request"); exact end-to-end create latency from our region; whether `pi` prebuilt template tracks latest pi releases (unknown cadence).

## Fit for our agentic stack
- **pi preinstallable?** Yes, trivially: E2B ships an official `pi` template (`Sandbox.create('pi', {envs:{ANTHROPIC_API_KEY}})`; guide at docs.e2b.dev/agents/pi shows `pi -p "..."`, `git.clone`, streaming `onStdout`, and layering via `Template().fromTemplate('pi')`). Or build our own from `fromNodeImage('24')` + `npmInstall('@earendil-works/pi-coding-agent', {g:true})` (exactly how their Claude Code template is defined). pi's `--mode json`/`rpc` output streams cleanly through `onStdout`; sessions in `~/.pi/agent/sessions` are readable via `files.read` and survive pause/snapshot.
- **Verdict:** Strong fit — arguably the best-documented option for exactly this workload (they literally document pi). 10 parallel 2 vCPU/4 GiB agents ≈ **$296/mo** on Pro; fork/snapshot gives cheap per-task warm clones replacing git worktrees; hostname egress allowlist covers "LLM API + GitHub + registries" precisely; pause-on-timeout prevents lost work. Main costs/risks are the fixed $150 plan fee, idle billing while waiting on the LLM, and per-template RAM sizing. Recommend as primary or co-primary candidate; compare against cheaper per-second providers (Daytona/Northflank/Sprites) if the plan fee dominates.

## Related resources mentioned
- `e2b-dev/infra` (Apache-2.0 self-host), `e2b-dev/E2B` monorepo (JS/Python SDKs, CLI, desktop SDKs), `e2b-dev/code-interpreter`, `e2b-dev/desktop`, `e2b-dev/e2b-cookbook`, `e2b-dev/claude-code-fastapi`, `bxxf/codebox` (Claude Code over PTY in E2B).
- Docs pages: /agents/pi, /agents/claude-code, /sandbox/persistence, /sandbox/fork, /sandbox/snapshots, /sandbox/filesystem-only-snapshots, /sandbox/auto-resume, /sandbox/workload-identity, /sandbox/git-integration, /network/internet-access, /network/byop, /template/*, /volumes, /billing, /faq/*, /changelog.
- Third-party: northflank.com/blog/ai-sandbox-pricing & /e2b-vs-vercel-sandbox (2026-04-08), beam.cloud/blog/e2b-pricing-explained, blaxel.ai/blog/e2b-session-limit, rywalker.com/research/e2b, morphllm.com/e2b-pricing, wincent gist (E2B = "the reference AI agent sandbox"), HN threads 38712634 / 40099045 / 41860413 / 42121698.

## Key quotes / references
- "Sandboxes can run continuously for up to 24 hours (Pro) or 1 hour (Base)… pause and resume functionality preserves state indefinitely." — docs.e2b.dev/sandbox
- "Paused sandboxes are kept indefinitely; there is no automatic deletion or time-to-live limit." / "Only running sandboxes count toward your concurrency limit." — docs/sandbox/persistence, docs/faq/paused-sandboxes-concurrency
- "Pausing: approximately 4 seconds per 1 GiB RAM; Resuming: approximately 1 second." — docs/sandbox/persistence
- "The snapshot is captured once regardless of how many forks you request… You can request up to 100 forks at once." — docs/sandbox/fork
- "This allows us to load the sandbox in ~80ms any time later with all the processes already running." — docs/template/how-it-works
- "Disk size is not a per-sandbox setting… there is no disk-size parameter." — docs/template/build
- "E2B does not publish a list of egress CIDRs, and there are no dedicated or static egress IP addresses on any plan." — docs/faq/egress-ip-ranges
- "Pi does not show permission prompts for its built-in tools, so no auto-approval flag is needed… sandboxes can reach the open internet by default — restrict outbound traffic with network rules." — docs.e2b.dev/agents/pi
- "vCPU $0.000014 per second ($0.0504/h); RAM $0.0000045 per GiB per second ($0.0162/h); Disk included (10 GiB Hobby / 20 GiB Pro)." — docs/faq/calculate-sandbox-price
- Firecracker: "~50,000 lines of code vs QEMU's ~2 million… as little as 125ms… less than 5MB RAM overhead." — e2b.dev/blog/firecracker-vs-qemu (2025-03-03)

**Gaps:** Could not fetch `docs.e2b.dev/sandbox/limits`, `/sandbox/compute`, `/self-hosting`, `/sandbox/regions` (404 — content lives in /billing, /template/build, /faq/egress-ip-ranges and infra `self-host.md` instead). Late-2025 changelog entries (persistence GA date, template SDK launch date) not retrieved — only Jul–Aug 2026 entries. `e2b-cookbook` claude-code example page 404'd via WebFetch. HN thread bodies were mostly unavailable (only titles/one comment). Exact snapshot-storage pricing beyond plan disk, EU-region surcharge (if any), and whether the prebuilt `pi` template pins a specific pi version are unverified. No independent latency benchmark from our region.
