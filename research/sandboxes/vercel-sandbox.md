# Vercel Sandbox
- **URL:** https://vercel.com/docs/sandbox (the old `/docs/vercel-sandbox/*` paths now 404 / redirect; canonical is `/docs/sandbox`)
- **Type:** sandbox
- **Author/Org:** Vercel
- **Researched:** 2026-08-26
- **Status/maturity:** GA since 2026-01-30 (blog "Run untrusted code with Vercel Sandbox, now generally available"). SDK+CLI are open source: github.com/vercel/sandbox — Apache-2.0, 193 stars, repo created 2026-01-23, last push 2026-08-26 (nightly image builds). npm `@vercel/sandbox` 3.1.0 (2026-08-21), npm `sandbox` CLI 4.1.0 (2026-08-21), Python SDK in the `vercel` package. Persistence GA 2026-05-26; Managed Images 2026-08-10; 10k concurrency 2026-08-05; 4 regions 2026-08-24; Drives = private beta. $1M HackerOne escape challenge running 2026-08-18 → 09-01. Backend (Firecracker orchestration, "Hive") is proprietary/managed only; no self-host, no BYOC.

## One-paragraph summary
Vercel Sandbox is a managed, per-sandbox Firecracker microVM service (each VM has its own guest kernel; a container inside the VM runs your code, but the VM is the security boundary) with a Docker-like CLI (`sandbox`/`sbx`), a TypeScript SDK (`@vercel/sandbox`) and a Python SDK. Sandboxes boot from OCI images (Vercel Managed Images or your own pushed to Vercel Container Registry), have full passwordless `sudo`, 2 GB RAM per vCPU, 32 GB NVMe, up to 15 public ports, a host-enforced egress firewall (SNI/CIDR allowlists, header-injection "credentials brokering", request proxying), and are *persistent by default*: on stop the filesystem is auto-snapshotted and the next SDK call auto-resumes a new "session" from it. The default image `vercel/sandbox/universal` (Ubuntu 26.04, Node 24, Bun, Python 3.14) **ships with `pi` preinstalled** alongside Claude Code, Codex and opencode. Pricing is usage-based on Pro ($0.128 per active-vCPU-hour, $0.0212 per provisioned GB-hour, iad1); Hobby is free but capped (5 CPU-h/month, 45-min sessions, 10 concurrent) and useless for our load. Estimated cost for our 10-agent factory: roughly **$95–$285/month** (best guess ~$130) including the $20 Pro seat.

## Core ideas / thesis
- "Compute primitive designed to safely run untrusted or user-generated code" for AI agents; same Firecracker fleet that runs Vercel builds (2.7M deployments/day).
- microVM per sandbox (not container) ⇒ they explicitly allow Docker-in-sandbox, VPN clients, FUSE mounts with `sudo`.
- Persistence model = *sandbox* (named, long-lived) ⊃ *sessions* (individual VM boots, each capped by plan max duration); filesystem is the durable thing, memory is not.
- Security posture: firewall enforced on the host outside the VM; secrets can be kept out of the VM entirely via header transforms at the proxy (credentials brokering).
- Bill for **active CPU only** (I/O wait, e.g. waiting on an LLM, is free), but provisioned memory is billed for the whole session.
- Everything you touch (SDK, CLI, images) is OSS; the control plane is not.

## Architecture & mechanics
**Isolation tech.** Firecracker microVM per sandbox on bare-metal EC2 hosts; dedicated guest kernel; inside the VM a Linux container runs the operator's code ("two layers removed from the host"). Container-namespace escapes inside the guest are explicitly out of scope of their bounty — the VM is the boundary. SOC 2 Type II. Default user `ubuntu` (uid 1000) with passwordless sudo; SDK docs note `sudo` commands run as `vercel-sandbox` with `/root` home. Kernel-level process isolation, private filesystem, own network namespace.

**Cold start.** Marketing: "sandboxes start in milliseconds"; GA blog: "sub-second startup for thousands of sandboxes". Vercel's own snapshot guide measured a fresh create + `npm i` of 4 packages at 16.49 s vs 0.41 s resuming from a snapshot. Realistic expectation for a git-clone + image boot: a few seconds; from a snapshot: sub-second to ~1 s (unverified independently).

**Snapshot / fork / pause-resume.**
- Snapshots are **filesystem-only** (no memory/process state). `sandbox.snapshot()` captures FS *and stops the VM* (sandbox becomes unreachable). Creating from a snapshot boots a new session.
- Persistent sandboxes (default): on `stop()`/timeout the SDK auto-snapshots; any later `runCommand`/`writeFiles` auto-resumes a new session from the last snapshot (fresh timeout). `stop()` and `update()` do not auto-resume.
- `Sandbox.fork({ sourceSandbox })` = new sandbox seeded from the source's current snapshot, inheriting config incl. env; override `name`, `resources`, `env`, `persistent`, `region`.
- Snapshot retention: expire 30 days after last use by default; `snapshotExpiration` (0 = never), `keepLastSnapshots: { count: 1–10, expiration, deleteEvicted }`. Snapshots outlive sandbox deletion (and keep billing). Snapshot lineage viewable with `Snapshot.tree()` / `sandbox snapshots tree`.
- Snapshots are region-bound (`snapshot_region_mismatch` otherwise; failover regions are the exception).
- No true pause/resume of memory; "resume" always = reboot from FS snapshot.

**Persistence & idle/auto-stop.** Session timeout default 5 min; set `timeout` (ms) at create, `extendTimeout(ms)` while running; max per session 45 min (Hobby) / **24 h** (Pro/Enterprise). No idle-detection auto-stop — you pay provisioned memory until timeout or `stop()`. Sandboxes that can't resume (non-persistent, or snapshot expired) are garbage-collected after 14 days. 32 GB ephemeral NVMe per sandbox. Drives (private beta, free for now): up to 4 per sandbox, 100 GiB default / 1 TiB max, single reader-writer, region-bound.

**Networking.**
- Ingress: declare `ports: [3000]` (max 15) → `sandbox.domain(3000)` returns a public HTTPS URL (no auth by default — "be mindful"). Traffic to/from exposed ports is billable both directions.
- Egress: default `allow-all`. `deny-all` blocks everything incl. DNS. User-defined policy: `allow` (domains, wildcard whole labels, SNI-matched so TLS only), `subnets.allow` / `subnets.deny` (CIDR; plain HTTP or IP-only). Live-updatable on a running sandbox via `sandbox.update({ networkPolicy })`. Postgres-over-TLS supported by domain. Domain fronting caveat documented. Firewall on Hobby since 2026-08-05.
- Credentials brokering: per-domain `transform: [{ headers: {...}, match?: {path, method, queryString, headers} }]` injects headers at the proxy; TLS is terminated for those domains using a per-sandbox CA already in the system trust store (+ `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, etc. preset). Containers inside the sandbox don't inherit the CA.
- Request proxying: `forwardURL` sends matching requests to your proxy with an OIDC token (`vercel-sandbox-oidc-token`, claims team_id/project_id/sandbox_id/sandbox_name); helper `defineSandboxProxy` from `@vercel/sandbox/proxy`.
- Downloads are free; uploads (egress) $0.15/GB after 20 GB (Hobby) / from byte 1 on Pro (against the $20 credit).

**Secrets model.** (a) `env` at create (sandbox-wide defaults) or per `runCommand({ env })`; (b) `source.git` `username: 'x-access-token', password: token` for private clones; (c) preferred: credentials brokering so the API key/GitHub token never enters the VM (this is exactly what Vercel's own "Foreman" software-factory template does for GitHub App installation tokens). Auth to the service itself: `VERCEL_OIDC_TOKEN` (12 h, `vercel env pull`) or `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`.

**Limits (2026-08-21 pricing page).**
| | Hobby | Pro | Enterprise |
|---|---|---|---|
| Max vCPU / RAM per sandbox | 4 / 8 GB | **8 / 16 GB** | 32 / 64 GB |
| vCPU choices | 1 or even numbers 2–32 (2 GB RAM per vCPU, default 2) | | |
| Disk | 32 GB NVMe | 32 GB | 32 GB |
| Ports | 15 | 15 | 15 |
| Max session | 45 min | 24 h | 24 h |
| Concurrent sandboxes | 10 | 10,000 | 10,000 |
| vCPU allocation rate | 20→40/min | 150→5,000/min (dynamic ramp, resets after 10 min idle) | same |
| Control-plane API | 1k req/min | 10k req/min | 100k req/min |
| Regions | iad1 (default), sfo1, cle1, cdg1; failover regions Pro+ only | | |

**OSS / self-host.** SDK, CLI, image Dockerfiles: Apache-2.0 at github.com/vercel/sandbox (`images/{ubuntu,universal,node,python,arch,al-base,al-node,al-python}`). Runtime is managed-only; no self-hosting, no GPU.

## API / SDK (concrete)
SDK languages: TypeScript/JS (`@vercel/sandbox`, Node 22+), Python (`vercel` package, `vercel.sandbox`), REST API (`/docs/rest-api/sandboxes/*`), CLI `sandbox` (npm), plus `vercel sandbox` inside the main Vercel CLI (since 2026-04-08). Multi-user (`createUser`/`asUser`) is JS-only.

```bash
npm i -g sandbox vercel            # CLI (alias: sbx)
pnpm i @vercel/sandbox             # SDK
vercel link && vercel env pull     # writes VERCEL_OIDC_TOKEN into .env.local (12 h)
# or for CI / non-Vercel hosts:
export VERCEL_TOKEN=... VERCEL_TEAM_ID=team_xxx VERCEL_PROJECT_ID=prj_xxx
```

```ts
import { Sandbox } from '@vercel/sandbox';
import ms from 'ms';

// create from git (private), default universal image (Node 24, Python 3.14, pi/claude/codex/opencode preinstalled)
const sandbox = await Sandbox.create({
  name: 'agent-07',                                   // unique per project; enables get()/getOrCreate()
  image: 'vercel/sandbox/universal:latest',           // or 'vercel/sandbox/node:24', 'my-repo:v1', 'team/project/repo@sha256:...'
  source: { type: 'git', url: 'https://github.com/org/repo.git',
            username: 'x-access-token', password: process.env.GH_TOKEN!, depth: 1, revision: 'main' },
  // source: { type: 'tarball', url } | { type: 'snapshot', snapshotId }
  resources: { vcpus: 2 },                            // 2048 MB RAM per vCPU
  timeout: ms('4h'),                                  // per-session; max 24h on Pro
  ports: [3000],
  region: 'iad1', failoverRegions: ['cle1'],
  env: { ANTHROPIC_BASE_URL: 'https://ai-gateway.vercel.sh' },
  persistent: false,                                  // default true (auto-snapshot on stop)
  snapshotExpiration: ms('7d'), keepLastSnapshots: { count: 1 },
  tags: { role: 'implementer' },
  networkPolicy: {
    allow: {
      'api.anthropic.com': [{ transform: [{ headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY! } }] }],
      'github.com': [{ transform: [{ headers: { authorization: `Bearer ${ghToken}` } }] }],
      'api.github.com': [], 'registry.npmjs.org': [], '*.npmjs.org': [], 'pypi.org': [], 'files.pythonhosted.org': [],
    },
    subnets: { deny: ['169.254.0.0/16'] },
  },
});

// run (blocking), stream, detach
const r = await sandbox.runCommand({ cmd: 'pi', args: ['-p', '--mode', 'json', 'fix the failing test'],
  cwd: '/vercel/sandbox/repo', env: { PI_FOO: '1' }, stdout: process.stdout, stderr: process.stderr });
r.exitCode; await r.stdout(); await r.output('both');
const bg = await sandbox.runCommand({ cmd: 'bash', args: ['-c', 'pi --mode rpc'], detached: true });
for await (const log of bg.logs()) { /* {stream:'stdout'|'stderr', data} */ }
await bg.wait(); await bg.kill('SIGTERM'); await sandbox.getCommand(bg.cmdId);
await sandbox.runCommand({ cmd: 'apt-get', args: ['install', '-y', 'golang'], sudo: true });

// files (default cwd /vercel/sandbox; node:fs/promises-compatible sandbox.fs also exists)
await sandbox.writeFiles([{ path: '/home/ubuntu/.pi/agent/settings.json', content: Buffer.from(json), mode: 0o600 }]);
const buf = await sandbox.readFileToBuffer({ path: 'out/diff.patch' });   // null if missing
await sandbox.downloadFile({ path: 'dist.tar.gz' }, '/local/dist.tar.gz');
await sandbox.mkDir('work');

// ports, timeout, snapshots, lifecycle
sandbox.domain(3000);                              // public URL
await sandbox.extendTimeout(ms('30m'));            // check sandbox.timeout first
const snap = await sandbox.snapshot({ expiration: 0 });     // STOPS the VM; returns snapshotId
const child = await Sandbox.fork({ sourceSandbox: 'golden', name: 'agent-08', persistent: false });
const same = await Sandbox.get({ name: 'agent-07' });        // auto-resumes on next call
const sb = await Sandbox.getOrCreate({ name: 'ws-1', resume: true,
  onCreate: async s => { await s.runCommand('git', ['clone', url, '.']); },
  onResume: async s => { /* restart daemons */ } });
await sandbox.update({ networkPolicy: 'deny-all', resources: { vcpus: 4 }, ports: [3000] });
const fin = await sandbox.stop();   // { snapshot?, activeCpuDurationMs, networkTransfer:{ingress,egress} }
await sandbox.delete();             // snapshots survive; delete via Snapshot.get(id).delete()
for await (const s of Sandbox.list({ tags: { role: 'implementer' } })) {}
// multi-user isolation inside one VM
const u = await sandbox.createUser('agent1'); await u.runCommand('whoami'); await sandbox.createGroup('shared');
```

CLI equivalents (Docker-flavoured):
```bash
sandbox login
sandbox create --name agent-07 --image vercel/sandbox/universal --vcpus 2 --timeout 4h -p 3000 \
  --env FOO=bar --tag role=impl --snapshot-expiration 7d --keep-last-snapshots 1 \
  --allowed-domain api.anthropic.com --allowed-domain github.com --network-policy deny-all   # or --non-persistent
sandbox run --name agent-07 --timeout 4h -- pi -p "do the task"      # create-or-resume + exec; --rm deletes after
sandbox exec --workdir /vercel/sandbox/repo --env X=1 agent-07 -- git diff
sandbox exec --sudo agent-07 -- apt-get install -y ripgrep
sandbox connect agent-07            # interactive shell (aliases: ssh, shell)
sandbox cp ./in.txt agent-07:/tmp/in.txt ; sandbox cp agent-07:/tmp/out.patch ./
sandbox snapshot agent-07 --stop --expiration 0 ; sandbox snapshots list|get|delete|tree
sandbox fork golden --name agent-09
sandbox config vcpus agent-07 4 ; sandbox config network-policy agent-07 ... ; sandbox sessions list agent-07
sandbox stop agent-07 ; sandbox remove agent-07 ; sandbox list
vercel project update my-project --sandbox-region sfo1 --sandbox-failover-regions cle1,iad1
vercel vcr build docker . my-repository:latest --push        # custom image → VCR
```
Custom images: any linux/amd64 OCI image pushed to VCR (`Ready` state required); `ENTRYPOINT`/`CMD` are ignored; `WORKDIR` honoured. Deprecated `runtime: 'node22'|'node24'|'node26'|'python3.13'` (Amazon Linux 2023) still accepted.

## Workflow: end to end (for our factory)
1. **Image.** Zero work: `vercel/sandbox/universal:latest` already runs `npm install -g --ignore-scripts @earendil-works/pi-coding-agent` (Dockerfile line 88, verified 2026-08-26) on Node 24 + Bun. For a pinned pi version / extra tools, `FROM vcr.vercel.com/vercel/sandbox/universal:latest` (or `ubuntu`) → `npm i -g @earendil-works/pi-coding-agent@X` → `vercel vcr build docker . pi-agent:v1 --push`; or build once, `sandbox snapshot --expiration 0`, and `Sandbox.fork` from a golden sandbox.
2. **Per task (×10 in parallel):** `Sandbox.create({ name: task-<id>, image, source:{git, depth:1, revision}, resources:{vcpus:2}, timeout: ms('4h'), persistent:false, networkPolicy: allowlist + credential transforms for the LLM API/AI Gateway + GitHub })`. vCPU allocation ramp on Pro (150→5,000 vCPU/min) is far above our 20 vCPU burst.
3. `writeFiles` pi config (`~/.pi/agent/settings.json`; put auth via env/`auth.json` only if not using brokering — with brokering, point pi at the API host and let the proxy add the key so the key never lives in the VM).
4. `runCommand({ cmd:'pi', args:['-p','--mode','json', prompt], cwd, detached:true })` → iterate `logs()` for JSONL events → `wait()`. Extend with `extendTimeout` if needed (cap 24 h/session).
5. Collect: `git diff`/`git format-patch` via `readFileToBuffer`, or have pi push a branch (token injected by firewall; Foreman validates branch names before push). Copy `~/.pi/agent/sessions/*.jsonl` out for audit.
6. Teardown: `stop()` (returns activeCpuDurationMs + egress bytes for per-task cost accounting) then `delete()`; or keep `persistent:true` + `keepLastSnapshots:{count:1}` for resumable long-lived agent workspaces.
7. Ops: `sandbox connect <name>` to debug live; dashboard Observability → Sandboxes; Spend Management alerts.

## Pricing
Rates (iad1, Pro/Enterprise, docs last updated 2026-08-21): Active CPU **$0.128 per vCPU-hour** (only while CPU is busy; I/O/LLM wait free); Provisioned Memory **$0.0212 per GB-hour** (whole session, 1-min minimum); Creations $0.60 per 1M; Data transfer out $0.15/GB (in free); Snapshot storage $0.08/GB-month (Enterprise column; the Pro column shows "$0.002630137/GB-month" which is ≈ $0.08/30.4 — looks like a per-day figure mislabeled; Drives page states $0.08/GB-month; **treat as $0.08/GB-month**). Pro seat $20/user/month, which includes a $20 usage credit. Hobby: free, 5 active-CPU-h + 420 GB-h + 20 GB egress + 15 GB snapshots lifetime, 10 concurrent, 45-min sessions → unusable for us. sfo1/cle1/cdg1 rates "vary" (table not rendered in fetched page; iad1 is cheapest/default assumption).

Our load: 10 sandboxes × 2 vCPU × 4 GB × 4 h/day × 22 days = **880 sandbox-hours**.
- Memory: 880 h × 4 GB = 3,520 GB-h × $0.0212 = **$74.62**
- Active CPU: 880 h × 2 vCPU = 1,760 vCPU-h. @100 % = $225.28; coding agents mostly wait on the LLM — @15 % ≈ 264 vCPU-h = **$33.79**; @25 % = $56.32; @40 % = $90.11.
- Creations: ~440/month ≈ $0.0003. Egress (git pushes + request bodies): ~5 GB ≈ $0.75. Snapshots: 0 if `persistent:false`; if persistent with `keepLastSnapshots:{count:1}`, ~10 × 5 GB × $0.08 ≈ $4 (universal image snapshot size unknown).
- Pro plan: $20, with $20 credit applied to usage.
- **Total ≈ $20 + $74.62 + $34–$90 + ~$5 − $20 credit ≈ $115–$170/month typical; $95 floor (near-idle CPU), $285 worst case (100 % CPU).** Dominated by provisioned memory, so stop sandboxes promptly and don't over-provision vCPUs (RAM scales with vCPU: 2 vCPU ⇒ 4 GB fixed; 8 GB requires 4 vCPU and doubles memory cost to $149).

## Notable techniques worth stealing
- **Credentials brokering**: inject `Authorization`/`x-api-key`/GitHub token at the egress proxy so keys never enter the agent VM; matchers restrict by path/method (e.g. allow `POST /v1/messages` only). Pair with `deny-all` + live policy tightening ("install deps with allow-all, then lock down before running the agent").
- **Sandbox/session split**: long-lived named workspace, bounded sessions, auto-snapshot on stop, `getOrCreate` with `onCreate`/`onResume` hooks — a clean model for resumable agent workspaces.
- **Golden sandbox + `fork()`** instead of tracking snapshot IDs; `Snapshot.tree()` lineage.
- `stop()` returning `activeCpuDurationMs` and `networkTransfer` → per-task cost attribution for free.
- Multi-user-in-one-VM (`createUser`, setgid `/shared/<group>`) for cheap sub-isolation of cooperating agents.
- Nightly-rebuilt, digest-pinnable OSS base images that already carry pi/claude/codex/opencode.
- `forwardURL` + `defineSandboxProxy` with OIDC claims: audit every LLM/GitHub call from every sandbox through your own proxy.

## Weaknesses / open questions / risks
- Managed-only; no self-host, no GPU; single vendor (Vercel) with an April-2026 security incident on record (unrelated to Sandbox per HN thread; not deeply verified).
- Memory is billed for the whole session, no idle auto-stop — a forgotten 24 h sandbox costs ~$2/day at 4 GB plus any CPU. Need our own reaper.
- No memory snapshots → resume is a reboot; background processes must be restarted via `onResume`.
- Pro cap 8 vCPU/16 GB; RAM rigidly 2 GB/vCPU (can't do 2 vCPU / 8 GB).
- Firewall is SNI-based: plain HTTP needs CIDR rules; domain fronting caveat; SSH (non-TLS) to GitHub needs CIDR allow and bypasses brokering — use HTTPS git.
- Public port URLs are unauthenticated.
- Snapshots are region-locked; deleted sandboxes leave snapshots that keep billing unless `keepLastSnapshots`/explicit delete.
- Pro snapshot price ambiguity in docs ($0.0026 vs $0.08 per GB-month).
- OIDC dev token expires every 12 h (use access token for a daemonized orchestrator).
- Rate limits: control-plane 10k req/min on Pro is fine; deletions 20/s.
- `runCommand` runs the binary directly (no shell) — wrap in `bash -c` for pipes/redirects.
- Drives (shared cache) still private beta, single-writer.

## Fit for our agentic stack
- **pi preinstallable?** Already preinstalled in the default image (`pi --version` is part of the image smoke test), on Node 24 (pi needs Node ≥ 24) with Bun also present; upgrade/pin via `sudo npm i -g @earendil-works/pi-coding-agent@<ver>` in a custom VCR image or a golden snapshot. `~/.pi/agent/{settings.json,auth.json,sessions/}` written with `writeFiles` (home is `/home/ubuntu`; default cwd `/vercel/sandbox`).
- **Verdict:** Strong fit. Meets every hard requirement (10+ concurrent, 2 vCPU/4 GB, 4 h+ sessions up to 24 h, outbound to LLM/GitHub/registries, git per sandbox, root). Firewall + credentials brokering is the best secrets story among managed sandboxes and is precisely what Vercel's own "Foreman" software factory uses. Cost ~$115–170/mo is competitive; TS SDK matches pi's ecosystem. Main trade-offs: vendor lock-in (proprietary runtime), no memory snapshots, and needing our own idle reaper. Requires Pro ($20/mo).

## Related resources mentioned
- github.com/vercel/sandbox (SDK, CLI, images) — Apache-2.0
- github.com/vercel-labs/coding-agent-template — "Multi-agent AI coding platform" (Claude Code, Codex, Copilot, Cursor, Gemini, opencode in Sandbox; Next.js + Neon; 1,769 stars; license NOASSERTION; timeouts 5 min–5 h in UI)
- github.com/vercel-labs/eve-software-factory-template ("Foreman", MIT, 1,090 stars, pushed 2026-08-20) + vercel.com/kb/guide/eve-software-factory (2026-08-25) — classifier/analyst/implementer/reviewer stations, Sandbox checkouts, GitHub tokens injected at the firewall
- eve framework: vercel.com/docs/eve, eve.dev/docs/sandbox
- KB guides: using-vercel-sandbox-claude-agent-sdk, running-opencode-securely-with-the-vercel-sandbox, sandbox-private-github-repositories, how-to-install-system-packages-in-vercel-sandbox, how-to-use-snapshots-for-faster-sandbox-startup, vercel-sandbox-duration-and-persistence, how-to-reconnect-to-a-running-sandbox, run-herdr-coding-agents-isolated-vercel-sandboxes, devin-outposts-vercel-sandbox
- Ecosystem docs: /docs/sandbox/ecosystem (LangChain, OpenAI SDK, Anthropic SDK, AI SDK; Devin, Herdr, Hermes)
- Blog: vercel.com/blog/vercel-sandbox-is-now-generally-available (2026-01-30); vercel.com/blog/one-million-dollar-hacker-challenge-for-vercel-sandbox (2026-08)
- Changelogs: vercel-sandboxes-ga; safely-inject-credentials-in-http-headers-with-vercel-sandbox (2026-02-23); vercel-sandbox-persistent-sandboxes-beta (2026-03); sandbox-persistence-is-now-ga (2026-05-26); run-docker-containers-inside-vercel-sandbox (2026-05); node-js-26-x-now-available-on-vercel-sandboxes; full-sandbox-egress-firewall-now-available-on-hobby-plan (2026-08-05); vercel-sandbox-now-supports-10-000-concurrent-sandboxes-and-5-000-vcpus-per-minute (2026-08-05); vercel-sandbox-managed-images (2026-08-10); vercel-sandbox-is-now-globally-available (2026-08-24)
- Third-party: northflank.com/blog/ai-sandbox-pricing (May 2026: Vercel "managed-only, no BYOC, no GPU"; at 200 concurrent ≈ $31k vs Northflank $7.2k); northflank.com/blog/vercel-sandbox-vs-railway-sandboxes; gist.github.com/wincent/2752d8d97727577050c043e4ff9e386e (lists Vercel under Firecracker microVM + hosted SaaS, "GA, filesystem snapshots")

## Key quotes / references
- "Each sandbox runs in its own Firecracker microVM with a dedicated kernel… microVM boundary prevents escapes." — /docs/sandbox/concepts
- "The default image is `vercel/sandbox/universal`, which includes the current Node.js LTS, Python 3.14, coding agents, and common utilities." — /docs/sandbox
- Universal README: "Coding agents: opencode (`opencode`), Claude Code (`claude`), Codex (`codex`), pi (`pi`)"; Dockerfile: `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`
- "Sandboxes are persistent by default: when a sandbox stops, the SDK automatically snapshots its filesystem" — /docs/sandbox/concepts
- "Time spent waiting for I/O (such as network requests, database queries, or AI model calls) does not count toward Active CPU." — /docs/sandbox/pricing
- "Credentials brokering allows the injection of credentials on egressing traffic, while ensuring those secrets never enter the sandbox scope" — /docs/sandbox/concepts/firewall
- "Git credentials never enter sandboxes—installation tokens are injected at the firewall as header transforms" — Foreman guide
- "Cold start 16.49 s vs warm start from snapshot 0.41 s" — KB snapshots guide
- Bounty blog: "bare-metal EC2 hosts… the network side of the boundary is enforced on the host, outside the microVM"

**Gaps:** Could not fetch the regional pricing table (sfo1/cle1/cdg1 Sandbox rates) — page renders it client-side; the Python SDK reference and REST API pages were not fetched; no independent cold-start benchmarks beyond Vercel's own numbers; exact snapshot size of the universal image (affects storage cost) unknown; Pro snapshot-storage rate ambiguous in docs; HN discussion threads on Sandbox GA not located; coding-agent-template license and its sandbox-creation code path (which image/how agents are installed) not read in detail; whether `--ignore-scripts` on the pi install omits anything pi needs at runtime not verified.
