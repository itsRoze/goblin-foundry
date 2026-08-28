# Fly.io Sprites

- **URL:** https://sprites.dev (marketing page redirects to https://fly.io/sprites/); docs at https://sprites.dev/docs (source: https://github.com/superfly/sprites-docs); API host `https://api.sprites.dev`; MCP `https://sprites.dev/mcp`
- **Type:** sandbox
- **Author/Org:** Fly.io (superfly). Launched publicly 2026-01-09 ("Code And Let Live", Kurt Mackey). Design writeup by Thomas Ptacek ("The Design & Implementation of Sprites", Jan 2026). MCP added March 2026 ("Unfortunately, Sprites Now Speak MCP").
- **Researched:** 2026-08-26
- **Status/maturity:** GA, usage-billed, self-service plans. Platform itself is closed-source / hosted-only (no self-host, no BYOC). SDKs and plugins are MIT on GitHub, all actively pushed within the last week: `superfly/sprites-js` (34 stars, pushed 2026-08-26), `superfly/sprites-go` (28, 2026-08-26), `superfly/sprites-py` (21, 2026-08-26), `superfly/sprites-ex` (22), `superfly/sprites-docs` (50, 2026-08-20), `superfly/sprites-mcp` (0, 2026-08-20), **`superfly/pi-sprites` (3 stars, MIT, pushed 2026-08-24) — an official Pi coding agent extension**. Fly said an open-source "local version" is planned (forward-looking, not shipped). SOC 2 Type 2; HIPAA BAA on request (per Blaxel's comparison, unverified by me).

## One-paragraph summary
Sprites are Fly.io's "computers for agents": Firecracker/KVM microVMs that are created in ~1–2 s from a pre-warmed pool of identical base images, have a persistent 100 GB ext4 root filesystem backed by object storage (NVMe as read-through/write-back cache), pause automatically ~30 s after activity stops (warm suspend in-place, later cold stop), and bill per-second only for CPU actually used (cgroup `cpu.stat`), actual memory used, and bytes actually written. Checkpoints are copy-on-write *disk* snapshots (not memory) taken live in well under a second at the block/metadata level, restorable in ~1 s (docs say "the environment restarts"); the last five are mounted read-only at `/.sprite/checkpoints/`. There is no custom image support — every Sprite starts from Fly's Ubuntu 25.x "DevTools" image (Node 22, Python 3.13, Go, Rust, Bun, Deno, Claude Code, Codex, Gemini CLI preinstalled) and you customize by running commands and then checkpointing. Each Sprite gets a private-by-default HTTPS URL, egress is unrestricted unless you attach a DNS-based allow/deny policy, and "Connectors" let a Sprite call GitHub/OpenRouter/any HTTP API through a gateway without ever holding the credential. Control surface: CLI (`sprite`), REST API, JS/TS, Go, Python, Elixir SDKs, a hosted OAuth MCP server, and a first-party `pi-sprites` package that routes pi's tools into a Sprite and offers worker pools.

## Core ideas / thesis
- "Robots don't want sandboxes. They want computers." Agents want a persistent, disposable, full Linux box with SSH-like latency, not an ephemeral container. (Kurt Mackey)
- Remove the user-facing container: every VM boots the same base image from a per-host pool, so create time is dominated by nothing (no image pull), ~60x faster than Fly Machines. Customization is *state* (filesystem overlay + checkpoints), not *images*. (Ptacek)
- Persistence is object-storage-first: authoritative state lives in S3-compatible storage (Tigris) with a JuiceFS-inspired SQLite/Litestream metadata layer; NVMe is a cache. This makes VMs migratable and checkpoints cheap metadata ops. (Ptacek)
- Bill for what is used, not what is allocated: CPU via `cpu.stat`, RAM as actually used, storage as bytes written (TRIM-friendly); warm/cold states cost nothing but cold storage.
- "Inside-out orchestration": services, checkpoint/restore, log aggregation and port binding are managed by root-namespace processes *inside* the VM, exposed via a Unix management socket (`/.sprite/api.sock`), so an agent can checkpoint/restore itself.
- Credentials should not live in the sandbox: Connectors (gateway with stored creds) and per-exec env injection (SpriteDoc pattern: "the user's token is never written to the Sprite").

## Architecture & mechanics
**Isolation.** Firecracker microVMs on Fly's KVM fleet ("hardware-isolated"; Fly's own learn page and devclass confirm Firecracker). Sprites use a distinct `fdf::/…` IPv6 prefix on `spr0`, separate from Fly Machines' 6PN (`fdaa::`). Not a container; the user code runs in an inner container inside the VM, managed by root-namespace services.

**Sizes.** Fixed: **8 vCPUs** per Sprite; memory is platform-managed and autoscaled ("not a fixed number to design around"; older docs say 4 GB / 8192 MB; HN and Simon's writeup observed ~8 GB); **100 GB** ext4 root (does not autoscale yet). The JS SDK exposes `config: { ramMB, cpus, region }` and Go `SpriteConfig{CPUs, RamMB, StorageGB, Region}`, but docs say "These values are not configurable yet." CPU-only, no GPUs.

**Latency (official + observed).**
- Create: "1–2 s" (docs, homepage); Northflank quotes "1–12 s"; HN: "roughly 1.5 s". Create returns a `cold` Sprite that warms on first request; `wait_for_capacity: true` blocks until a VM slot is available.
- Warm wake: 100–500 ms (VM suspended in place; processes resume mid-thought).
- Cold wake: 1–2 s (fresh boot; services restarted in dependency order).
- Idle → warm: ~30 s after last activity (not configurable). Warm → cold: "much longer" (community thread mentions full suspend after ~10 min; cold snapshots evicted when space needed / on upgrades). Kurt (community): "Sprites get memory snapshotted and then restored next time you use them… an intermediate warm state that's effectively just suspending everything in place." So memory *does* survive a warm pause, but any reboot/upgrade/cold transition drops it — design as if RAM is lost.
- Checkpoint create: homepage/Simon: ~300 ms, "live", non-interrupting; "Working with Sprites" doc says "10–30 seconds depending on data size" and that running processes stop during creation (older text; the newer Checkpoints concept page says work keeps going). Treat as sub-second for small deltas, tens of seconds for big ones.
- Checkpoint restore: ~1 s (blog), ~9 s in the "Building Agents that Don't Break Themselves" recovery demo; asynchronous, restarts the environment and kills active sessions; a following `sprite exec` auto-retries.

**Checkpoints (disk only).** Snapshot of the writable overlay on top of the base image: files, packages, dotfiles, on-disk DBs. NOT captured: processes, memory, open sockets. CoW at block level (with the early-access "S3 Block Device" backend it is a true block-level snapshot of an ext4-on-object-bucket device). IDs are sequential `v0, v1, …`; platform also takes automatic `auto-*` checkpoints (after continuous work, on idle, on graceful shutdown; tiered retention, pruned). Last 5 checkpoints mounted read-only at `/.sprite/checkpoints/<id>/` for diffing without restoring. Billed as cold storage for blocks kept; can't delete the checkpoint you're on. Restore is destructive (current state not auto-saved). There is **no fork/clone of one Sprite into another** in the public API today (Kurt's "Turn And Face The Strange" post mentions "drive forking capability" as a capability; not exposed in CLI/SDK docs — gap).

**Persistence / idle.** Two-tier: hot NVMe cache (billed only while running, ~$0.50/GB-mo equivalent) + durable object storage (Tigris; billed 24/7 at $0.02/GB-mo; hourly measured). Filesystem syncs continuously, so a pause moves nothing. `/tmp` not persisted across restart. Sprites never expire on their own; "cold sprites are unlimited" on plans. Services (`sprite-env services create`) are restarted by the runtime on boot/crash/cold wake; Tasks API (`POST /v1/tasks {expire: "1h"}` on the management socket, max 1 h, renewable heartbeat) holds a Sprite active for long agent runs.

**Networking.**
- Ingress: every Sprite has `https://<name>-<orgid>.sprites.app` routed to port 8080 (or first HTTP port opened); wakes the Sprite. URL auth: `sprite` (default: org members via browser session or org token; SDK also shows `privateAccess: 'admins'`) or `public`. `sprite proxy <port>` forwards any TCP port to localhost; `sprite exec` auto-forwards ports the command opens (`--no-port-forward` to disable); `sprite proxy -W :22` for SSH ProxyCommand.
- Egress: unrestricted by default. Opt-in per-Sprite **network policy** (set from outside via API/SDK/MCP; read-only inside at `/.sprite/policy/network.json`):
  ```json
  { "rules": [
      { "include": "defaults" },
      { "domain": "example.com",   "action": "allow" },
      { "domain": "*.example.com", "action": "allow" },
      { "domain": "blocked.com",   "action": "deny" } ] }
  ```
  `"include": "defaults"` = GitHub, npm, PyPI, Docker Hub, major AI APIs. Exact host > `*.sub` wildcard > `*`. `{"rules": []}` = no enforcement. Denied lookups return DNS `REFUSED`; raw-IP connections blocked unless the IP was resolved via an allowed name; private ranges always blocked; changes reload live and drop newly-blocked connections. Bandwidth/egress is not metered.
- Connectors: org-level stored credential (GitHub OAuth, OpenRouter BYOK or managed, Slack, Custom API with token in header/query/path) + deny-by-default access policy (name prefix / labels / allow-all) + gateway `https://api.sprites.dev/v1/gateway/<provider>/<connection_id>/<path>`; the Sprite sends no Authorization header — identity comes from Fly's request signature. Per-connector endpoint allow/block lists.

**Secrets model.** No first-class "secrets" object for Sprites. Options: (1) per-exec `env` (`sprite exec --env K=V`, SDK `env:`), which never touches disk — the recommended pattern; (2) the create-time `environment` map (Go `SpriteInfo.Environment`, JS `environment` option) — persisted in the Sprite record; (3) Connectors for third-party APIs. API tokens: `spr_…` org tokens created via `sprite org auth` / dashboard; `sprite auth setup --token "org/token-id/secret"` for CI; MCP uses OAuth 2.1 with `sprites:read`/`sprites:write` scopes and consent-time restrictions (name prefix, creation cap, labels, expiry).

**Limits.** Concurrency per org by plan: PAYG 3 running; Adventurer 20; Veteran 50; Hero 100 (+100 warm); … Mythic 2,000. Creation rate: 10/min PAYG, 60/min Adventurer, 240/min Mythic. No max session length (Sprites persist until destroyed). Task hold max 1 h per task (renewable).

**Regions.** Sprites are placed "in a Fly.io region close to you"; **you cannot choose a region** (Fly staff, community thread 26775; e.g. a German user landed in `fra`). SDK `region`/`PrimaryRegion` fields exist but are not honored/documented. No BYOC.

**OSS/self-host.** No. Hosted only. Fly staff have said an OSS local version is coming "relatively soon" (Jan 2026; nothing shipped as of this writing that I could find).

## API / SDK (concrete)
Auth: `Authorization: Bearer $SPRITES_TOKEN` against `https://api.sprites.dev`. Env vars: `SPRITES_TOKEN` (SDKs also accept `SPRITE_TOKEN`), `SPRITES_API_URL`. Public REST surface documented: `POST /v1/sprites`, `GET /v1/sprites`, `GET|PUT|DELETE /v1/sprites/{name}`, `POST /v1/sprites/{name}/exec` (WebSocket or `--http-post`), plus per-Sprite environment routes the SDKs wrap (checkpoints, services, policies, filesystem, tasks). Inside the VM: `http://sprite/v1/...` over `/.sprite/api.sock` (`sprite-env curl -X POST /v1/tasks -d …`).

CLI:
```bash
curl -fsSL https://sprites.dev/install.sh | sh          # ~/.local/bin/sprite
sprite login                                            # or: sprite org auth ; CI: sprite auth setup --token "org/id/secret"
sprite create agent-01 --skip-console --label factory   # 1–2 s
sprite exec -s agent-01 --dir /home/sprite --env ANTHROPIC_API_KEY=$KEY -- pi -p "fix the failing test"
sprite exec -s agent-01 --file ./task.json:/home/sprite/task.json -- cat /home/sprite/task.json   # upload-before-exec
sprite exec -s agent-01 -- bash -c 'cd repo && git diff' > out.diff                                 # "download" via stdout
sprite checkpoint create -s agent-01 --comment "pi + deps installed"   # -> v1
sprite checkpoint list --include-auto ; sprite checkpoint info v1 ; sprite checkpoint delete v0
sprite restore v1                                        # alias of sprite checkpoint restore
sprite config update --url-auth public|sprite ; sprite url ; sprite proxy 3000 ; sprite proxy 3001:3000
sprite sessions list|attach <id>|kill <id>               # TTY sessions are detachable (Ctrl+\)
sprite api /v1/sprites/agent-01 -- -X GET                # raw authenticated curl
sprite destroy -s agent-01
```

JS/TS (`npm i @fly/sprites`, Node ≥ 24):
```ts
import { SpritesClient, ExecError } from '@fly/sprites';
const client = new SpritesClient(process.env.SPRITES_TOKEN!, { baseURL: 'https://api.sprites.dev', timeout: 30000 });

const sprite = await client.createSprite('agent-01', {
  labels: ['factory'], waitForCapacity: true, runtime: 'default',
  urlSettings: { auth: 'sprite' },                  // or 'public'
  // config: { ramMB, cpus, region } exists in types but is "not configurable yet"
});

// run + buffer
const { stdout } = await sprite.exec('git clone https://github.com/me/repo /home/sprite/repo', { cwd: '/home/sprite' });
// stream (Node child_process-like)
const cmd = sprite.spawn('pi', ['-p', '--mode', 'json', 'fix bug #913'], {
  cwd: '/home/sprite/repo', env: { ANTHROPIC_API_KEY: process.env.KEY! } });
cmd.stdout.on('data', (b) => process.stdout.write(b));
cmd.on('message', (m) => { if (m.type === 'port_opened') console.log('port', m.port); });
const code = await cmd.wait();
// files (fs-like)
await sprite.fs.readFile('/home/sprite/repo/out.patch', 'utf8');      // SpriteFilesystem: readFile/readdir/mkdir/rm/stat/rename/copyFile/chmod/chown/appendFile/exists + live watch
// checkpoints (NDJSON progress streams)
const cp = await sprite.createCheckpoint({ comment: 'pi ready' }); await cp.processAll(console.log);
await (await sprite.restoreCheckpoint('v1')).processAll(console.log);
// egress
await sprite.updateNetworkPolicy({ rules: [{ include: 'defaults' }, { domain: 'api.anthropic.com', action: 'allow' }] });
// sessions / lifecycle
const s = sprite.createSession('bash'); const list = await sprite.listSessions(); sprite.attachSession(list[0].id);
await sprite.update({ labels: ['factory','done'] }); await sprite.restart(); await sprite.delete();
```
(Method names for checkpoint/policy are from the SDK module list — `checkpoint.ts`, `policy.ts`, `filesystem.ts`, `services.ts`, `watch.ts`; exact names for checkpoint/network-policy calls should be confirmed in `src/sprite.ts`. `execFileHTTP` exists but has a known framing limitation; prefer WebSocket `exec`.)

Go (`github.com/superfly/sprites-go`, `exec.Cmd`-style):
```go
client := sprites.New(os.Getenv("SPRITES_TOKEN"), sprites.WithBaseURL("https://api.sprites.dev"))
sp, _ := client.CreateSprite(ctx, "agent-01", &sprites.CreateSpriteOptions{WaitForCapacity: true})
cmd := sp.CommandContext(ctx, "pi", "-p", "run tests"); cmd.Dir = "/home/sprite/repo"; cmd.Env = []string{"ANTHROPIC_API_KEY=" + key}
out, err := cmd.StdoutPipe(); cmd.Start(); io.Copy(os.Stdout, out); cmd.Wait()   // *sprites.ExitError has ExitCode()
sess, _ := client.ProxyPort(ctx, "agent-01", 3000, 3000); defer sess.Close()
client.DeleteSprite(ctx, "agent-01")
```
Python (`superfly/sprites-py`) and Elixir (`Sprites.new/1`, `Sprites.cmd/3`, `Sprites.stream/3`) mirror the same surface.

MCP: `claude mcp add --transport http sprites https://sprites.dev/mcp` (OAuth; default token restricted to `mcp-` prefix + creation cap). 18 tools: `list_sprites/create_sprite/destroy_sprite`, `exec/exec_list/exec_kill`, `checkpoint_create/list/get/restore`, `service_list/get/create/start/stop/logs`, `network_policy_get/update`.

Official pi integration (`superfly/pi-sprites`): `pi install git:github.com/superfly/pi-sprites`; `export SPRITES_TOKEN=…`; `/sprite new pi-my-project`, `/sprite-bootstrap`, then pi's native `read/write/edit/bash/grep/find/ls` run remotely; `pi --sprite <name> --sprite-cwd /workspace/x`; config `.pi/sprites.json` (`checkpoint: risky|turn|off`, `bootstrap`, `policy`, `ci`, `workers: {count, agentCommand: "pi -p --no-session", cleanup}`, `rpcHost`); `/sprite-workers` fans tasks to a pool of Sprites each running `pi -p` over stdin; `/sprite-rpc install` runs pi as a Service exposing `/health`, `POST /rpc`, `GET /events` (SSE) behind a bearer token.

## Workflow: end to end (for our factory)
1. **Golden Sprite (one-time, no image build possible).** `sprite create golden --skip-console`; `sprite exec -s golden -- bash -lc 'npm i -g @earendil-works/pi-coding-agent && pi --version'` (base image ships Node 22.20 via nvm shims; pi needs Node ≥ 24 → `source /.sprite/languages/node/nvm/nvm.sh && nvm install 24 && nvm alias default 24`, or use the preinstalled **Bun**). Write `~/.pi/agent/settings.json`; do **not** write `auth.json` — inject the LLM key per exec. Optionally `git clone` the repo and warm caches. `sprite checkpoint create --comment "pi ready"` → `v1`.
   - Caveat: checkpoints are per-Sprite; there is no documented "create Sprite from checkpoint of another Sprite" or fork. So the golden image cannot be cloned into 10 new Sprites through the public API. Two workable patterns: (a) keep a **persistent pool** of 10 named Sprites (`agent-00..09`), each bootstrapped once and checkpointed; before every task `sprite restore v1` (~1–10 s) to reset to clean state, then run; (b) bootstrap each fresh Sprite with a script (`npm i -g` + clone is ~1–2 min; HN users complain apt/npm is slow) — acceptable for a pool that is reused, not for per-task creation.
2. **Fan-out.** Orchestrator (TS, `@fly/sprites`) loops over tasks: pick an idle pool Sprite, `restoreCheckpoint('v1')`, `exec('git fetch && git checkout -b task/123 origin/main')`, then `spawn('pi', ['-p','--mode','json', prompt], { env: { ANTHROPIC_API_KEY, GITHUB_TOKEN? } })` streaming JSON events to logs. Use `--mode rpc` + `pi-sprites` RPC host if you want a persistent pi service per Sprite. Register a Task via `sprite-env curl -X PUT /v1/tasks/agent -d '{"expire":"5m"}'` heartbeat inside the Sprite so a quiet LLM wait doesn't trip the 30 s idle pause (stdout output also resets the timer, so a streaming pi run is usually fine).
3. **Egress.** Set policy `{rules:[{include:'defaults'},{domain:'api.anthropic.com',action:'allow'},{domain:'*.github.com',action:'allow'},{domain:'registry.npmjs.org',action:'allow'}]}` from the orchestrator (defaults already cover GitHub/npm/PyPI/AI APIs). Prefer a GitHub Connector (gateway) over pasting a PAT if pushing via API; for `git push` over HTTPS a short-lived token in per-exec env is simplest.
4. **Collect.** `exec('git diff origin/main > /tmp/out.patch')` then `sprite.fs.readFile`, or have pi push a branch / open a PR via the GitHub Connector. Read `~/.pi/agent/sessions/*.jsonl` through the filesystem API for traces.
5. **Teardown.** Pool: let it pause (compute stops in ~30 s; ~$0.02/GB-mo storage). Per-task: `sprite.delete()`. Keep the golden checkpoint on each pool member; prune `auto-*` checkpoints occasionally.
6. Plan: Adventurer ($20, 20 concurrent) covers 10 parallel; PAYG's 3-concurrent cap does not.

## Pricing
Source: https://fly.io/sprites/ pricing section + FAQ, community "More Sprites Plans!" (2026-02-09), rywalker research; fetched 2026-08-26.
- CPU $0.07/CPU-hour (actual usage via `cpu.stat`); RAM $0.04375/GB-hour (actual usage); hot storage $0.000683/GB-hr (≈$0.50/GB-mo, while running only); cold storage $0.000027/GB-hr (≈$0.02/GB-mo, always). Per-second/hourly metering, nothing per-Sprite, no bandwidth charge. Warm and cold states: $0 compute.
- Plans (monthly fee; concurrent running; included CPU-hr / RAM GB-hr / storage GB-mo): PAYG $0 / 3 concurrent / none; **Adventurer $20 / 20 / 450 / 1,800 / 50**; Veteran $50 / 50 / 800 / 3,200 / 100; Hero $100 / 100 / 1,200 / 4,800 / 150; Champion $200 / 200 / 1,800 / 7,200 / 225; Legend $500 / 500 / 3,200 / 12,500 / 400; Epic $1,000 / 1,000 / 4,800 / 18,750 / 600; Mythic $2,000 / 2,000 / 7,200 / 28,000 / 900; Guild custom. Overage at PAYG rates. $30 trial credit per user/org ("~500 Sprites"). Fly account credits pay usage, not the subscription fee. Support: community below Hero.
- Fly's own example: a 4 h Claude Code session averaging 30% of 2 CPUs + 1.5 GB ≈ $0.44.

**Our workload:** 10 Sprites × 4 h/day × 22 days = 880 active Sprite-hours/month.
- Worst case (2 vCPU pegged, 4 GB resident): CPU 2 × 880 = 1,760 CPU-hr → $123.20; RAM 4 × 880 = 3,520 GB-hr → $154.00; hot storage 5 GB × 880 h × $0.000683 ≈ $3.00; cold storage 10 × 10 GB × $0.02 ≈ $2.00. PAYG would be ≈ **$282/mo** but PAYG caps at 3 concurrent, so a plan is required.
  - Adventurer: $20 + CPU overage (1,760−450)=1,310 × $0.07 = $91.70 + RAM overage (3,520−1,800)=1,720 × $0.04375 = $75.25 + storage (100−50) GB × $0.02 = $1.00 + hot ≈ $3 → **≈ $191/mo**.
  - Veteran: $50 + (1,760−800)=960 × 0.07 = $67.20 + (3,520−3,200)=320 × 0.04375 = $14.00 + $3 → **≈ $134/mo** (cheapest at worst case).
  - Hero: $100 + (1,760−1,200)=560 × 0.07 = $39.20 + $0 RAM + $3 → ≈ $142/mo.
- Realistic agent duty cycle (Fly's 30%-of-2-CPU, 1.5 GB average): CPU 0.6 × 880 = 528 CPU-hr; RAM 1.5 × 880 = 1,320 GB-hr → Adventurer: $20 + (528−450) × 0.07 = $5.46 + $0 + $1 + $3 → **≈ $30/mo**.
- So expect **$30–$190/month** depending on how CPU-hot the agents are; RAM is the dominant line when it is high.

## Notable techniques worth stealing
- Pre-warmed pools of identical base VMs on every host → 1–2 s create with zero image pull; customization as checkpointed state, not images.
- Object-storage-authoritative disk with NVMe cache + SQLite/Litestream metadata (JuiceFS-like) → CoW checkpoints are metadata shuffles; VMs are migratable.
- Three-state billing (running/warm/cold) with activity defined precisely (in-flight request, stdout output, open TCP, or explicit Task lease) and a renewable 1 h Task lease for agent loops.
- In-VM management socket (`/.sprite/api.sock`) + `sprite-env` so the agent can checkpoint/restore/register services itself; `/.sprite/llm.txt` describing the environment to the model.
- Read-only mounts of the last 5 checkpoints for `diff` without restore.
- DNS-based egress policy with `include: defaults` bundle, specificity ordering, raw-IP and private-range blocking, live reload.
- Connectors: credential broker keyed on VM identity (no token in the sandbox), deny-by-default access by name-prefix/labels.
- Per-exec env injection as the secrets model ("injected for the duration of that one command, gone when it returns").
- OAuth MCP tokens scoped by name prefix + creation cap.
- `pi-sprites` risky-mode auto-checkpoint before the first mutating tool call in a turn; worker pool that pipes tasks to `pi -p --no-session` over stdin.

## Weaknesses / open questions / risks
- **No custom base image / no Dockerfile / no OCI import** — a top HN complaint. Bootstrapping is scripted + checkpointed per Sprite.
- **No fork/clone from a checkpoint into a new Sprite** in the public API (only restore within the same Sprite). Fly mentions "drive forking" in a blog; not exposed. This blocks the "build once, stamp 10" pattern; you must maintain a pool.
- Fixed 8 vCPU / platform-managed RAM; no small/cheap tiers; no region selection; no GPUs.
- Idle detection quirks: at launch many users saw Sprites never idling (bug fixed per Chris McCord); stdout redirected to a file or tmux does not count as activity → a quiet pi run could be paused mid-LLM-call unless you stream output or hold a Task. Open TCP connections (e.g. a streaming Anthropic response) drop on pause.
- Warm memory snapshots are not exposed as a user feature; checkpoints are disk-only.
- Storage performance: `npm install`/apt described as "dog slow" at launch; Fly promised near-native "in the next few months" (Jan 2026) — unverified now.
- 100 GB not autoscaling; hot-storage costs ~$0.50/GB-mo for the working set while running.
- Docs still contain contradictions (RAM 4 GB vs 8 GB vs "managed"; checkpoint 300 ms vs 10–30 s; Ubuntu 25.04 vs 25.10); billing page marked `draft`. No usage metrics in CLI/API (dashboard only).
- No reboot/shutdown from inside; a hung VM can only be restored or destroyed.
- Node 22 in the base image; pi requires Node ≥ 24 (nvm install needed, or Bun).
- JS SDK `execFileHTTP` framing bug; use WebSocket exec.
- Closed platform; pricing on the higher end vs E2B/Daytona per Northflank's comparison ($0.07 vs $0.0504/vCPU-hr) though idle is free.

## Fit for our agentic stack
- **pi preinstallable?** Yes, as checkpointed state: `sprite exec -- bash -lc 'source /.sprite/languages/node/nvm/nvm.sh && nvm install 24 && nvm alias default 24 && npm i -g @earendil-works/pi-coding-agent'` then `sprite checkpoint create --comment "pi"`; or `bun install -g` with the preinstalled Bun. Fly also ships an official `pi-sprites` extension (worker pools, RPC host, auto-checkpoints) that assumes pi runs *locally* and routes tools into the Sprite, or runs `pi -p` inside worker Sprites.
- **Verdict:** Strong fit for a solo-dev factory of ~10 long-lived agent workers: cheap idle, ~1 s wake, persistent worktrees, disk checkpoints for reset-between-tasks, egress allowlist, credential brokering, and a first-party pi integration. The main friction is the absence of images/forking — plan on a persistent pool of pre-bootstrapped Sprites reset via `sprite restore`, not per-task creation from a template. Est. $30–$190/month on the $20 Adventurer plan (or ~$134 on Veteran at worst-case CPU).

## Related resources mentioned
- superfly/pi-sprites (official pi extension), superfly/sprites-js, sprites-go, sprites-py, sprites-ex, sprites-mcp, sprites-docs, sprites-claude-plugin, sprites-codex-plugin, sprites-opencode-plugin, openclaw-sprite-builder, llama-index-tools-sprites, sprites-adk.
- Fly blog: "Code And Let Live", "The Design & Implementation of Sprites", "Unfortunately, Sprites Now Speak MCP", "Building Agents that Don't Break Themselves" (SpriteDoc + Nous Hermes patterns), "Turn And Face The Strange".
- Simon Willison 2026-01-09; HN 46563308, 46561089, 46634450; Northflank alternatives + pricing posts; Blaxel alternatives; rywalker.com/research/sprites; wincent sandbox gist; PandaStack comparison; devclass coverage.
- Fly community threads: 26843 (memory snapshot), 26857 (plans), 26926 (stays warm), 26775 (regions), 26822 (cost tracking).

## Key quotes / references
- "Sprites are persistent Linux VMs that create in 1–2 seconds, checkpoint and restore in around 300ms, and automatically idle when inactive" — fly.io/sprites (Jan 2026 copy, via Simon Willison).
- "A checkpoint snapshots the writable filesystem overlay… It does not capture anything that only lives in memory." — sprites.dev/docs concepts/checkpoints.
- "Warm. The VM is suspended with everything in memory frozen in place… resumes it in 100–500ms… Cold… next wake takes 1–2s" — concepts/lifecycle.
- "Sprites have three states: running (billed), warm (not billed), and cold (not billed)." — fly.io/sprites FAQ.
- "Hero allows 100 concurrently running sprites and 100 warm sprites; cold sprites are unlimited… 10 sprites/minute on pay-as-you-go, rising… from 60/minute on Adventurer up to 240/minute on Mythic." — fly.io/sprites FAQ.
- "Raw IP connections are blocked unless the IP was resolved from an allowed domain… Private IPs are always blocked." — concepts/networking.
- "the user's token is never written to the Sprite. It is injected into the environment for the duration of that one command" — Fly blog, Building Agents that Don't Break Themselves.
- "it's not currently possible to specify a region when creating a sprite" — Fly staff, community thread 26775.
- "Sprites get memory snapshotted and then restored next time you use them" — Kurt Mackey, community thread 26843.
- "Sprites get rid of the user-facing container… I wish we'd done Fly Machines this way to begin with." — Thomas Ptacek, Design & Implementation.
- Docs sources: https://github.com/superfly/sprites-docs/tree/main/src/content/docs (checkpoints, lifecycle, networking, connectors, services, keeping-sprites-running, reference/billing [draft], reference/base-images [draft], reference/configuration [draft], integrations/remote-mcp, sdks/*, cli/commands).

**Gaps:** sprites.dev/docs pages 404 to WebFetch (read from the GitHub source instead; some pages are `draft: true` and may be stale). Could not read the JS SDK `sprite.ts` to confirm exact checkpoint/network-policy method names. Simon Willison's page returned 429 (used search summary + HN). Community "login-only" threads partially readable. Whether "drive forking" / create-from-checkpoint exists in any API is unverified (not in docs). Current storage throughput numbers, actual RAM ceiling per Sprite, and the S3 Block Device early-access status are unverified. Pricing arithmetic assumes RAM billed at resident usage (Fly: "Actual memory usage").
