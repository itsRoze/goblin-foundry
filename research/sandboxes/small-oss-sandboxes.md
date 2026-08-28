# Smaller / OSS sandbox options for the pi factory

- **Researched:** 2026-08-26
- **Scope:** boxd, Rivet sandbox-agent (+ agentOS), AgentBox (two projects share the name), and a compact tour of other OSS / self-host / small-vendor options (Gondolin, Northflank, OpenShell, container-use, microsandbox, Blaxel, Hopx, Together Code Sandbox / CodeSandbox SDK, Runloop, Morph Cloud).
- **Cost basis used everywhere:** 10 parallel agents x 2 vCPU x 4 GB x 4 h/day x 22 days = **880 machine-hours/month = 1,760 vCPU-hours + 3,520 GB-hours**. Storage assumed ~10 GB used per machine kept for the full month (7,200 machine-hours of disk). All rates are as fetched on 2026-08-26 unless noted.

---

# boxd

- **URL:** https://boxd.sh — docs https://docs.boxd.sh (llms-full.txt available) — pricing https://boxd.sh/pricing/
- **Type:** sandbox (persistent KVM microVMs, managed + self-host)
- **Author/Org:** Azin Tech (Amsterdam); GitHub org `azin-tech` (only demo repos public: `azin-tech/first-boot`, `azin-tech/mini-tools`). Underlying orchestrator: **Ignition** https://github.com/lttle-cloud/ignition (124 stars, AGPL-3.0, last push 2025-11-02).
- **Researched:** 2026-08-26
- **Status/maturity:** Commercial, single public PAYG tier, EUR-priced. Blog post "boxd vs exe.dev" (2026-05-04) says "Source license is pending" and references commits at `github.com/azin-tech/boxd` — that repo returns 404 today (private or not yet published). So **not OSS today**; self-host is "one Rust binary on KVM" but licensing is contact-sales. No star count. Product appears to have launched ~spring 2026.

## One-paragraph summary
boxd gives you real KVM virtual machines (own kernel, Ubuntu 24.04, 2 vCPU / 8 GiB / 100 GB CoW disk, own `name.boxd.sh` HTTPS domain + SSH port) that boot in ~6 ms from the base image, **fork live (memory + disk + running processes) in 100–200 ms** (marketing: 60 ms), suspend to RAM with sub-ms resume, hibernate to disk with ~85 ms resume, and have Claude Code / Codex / OpenCode preinstalled. Everything (CLI, TS/Python SDKs, console) sits on one public gRPC API at `boxd.sh:9443`. The same Rust binary is offered for self-hosting.

## Core ideas / thesis
- "Persistent cloud compute for the agent era": machines are long-lived computers that sleep for ~free, not ephemeral functions.
- Live fork is the primitive: fan out N attempts from one warm state; snapshots for golden images; checkpoints for in-place undo.
- Coding agents are first-class: preinstalled, pre-authenticated in-VM `boxd` CLI so agents can spawn sibling machines.

## Architecture & mechanics
- **Isolation:** KVM microVM per machine, own Linux kernel, network stack, disk ("code has root inside its own VM and no path to the host"). Built on Ignition (Firecracker-class VMM orchestration, snapshot-based).
- **Cold start:** fresh machine "boot: 6ms" (quickstart output); fork "boot: 160ms"; `--from-snapshot` wakes into captured state.
- **Fork:** `boxd machine fork src` — CoW copy of memory + disk + processes; running source pauses "a fraction of a second". Fork gets own 100 GB CoW disk, name, URL, ports. Same PIDs/uptime continue. Forks of hibernated sources wake the copy; stopped sources boot the copy fresh from disk.
- **Snapshot:** `boxd snapshots save vm name` — named, versioned image of disk **and memory**; machine must be running; outlives the machine; `boxd machine new x --from-snapshot name`. No hard cap.
- **Checkpoint:** `boxd machine checkpoint save|restore|list|remove vm name` — memory+disk save point restored **in place** (reboot into state); max 10 per machine; deleted with machine.
- **Pause/resume:** three states — running / standby (frozen in host RAM, sub-ms wake, "near zero" cost, still billed RAM+disk) / hibernated (written to disk, ~85 ms wake, disk-only billing). Auto-suspend off by default (`auto-suspend.timeout`), auto-hibernate **on by default after 4 h with no inbound network traffic** (`auto-hibernate.timeout`, 0 = never). **Warning:** idle timers watch network, not CPU — a long agent run with no inbound traffic gets frozen at 4 h; clocks freeze while suspended.
- **Persistence:** persistent disk, unlimited runtime, machines survive for weeks parked.
- **Networking:** every machine gets `name.boxd.sh` HTTPS (TLS terminated) + dedicated SSH port; unlimited subdomain proxies (`boxd machine proxy set-port --vm x --port 3000`), 3 raw TCP/UDP forwards; VM-to-VM private network; Tailscale support; `--isolated` flag cuts a machine off from your fleet/integrations/metadata endpoint. **No egress allowlist**: "Internet egress is the only shared surface" — outbound is unrestricted.
- **Secrets:** org-level `boxd env set KEY val [--secret] [--scope shared|private|all]`; secrets are sealed at rest and never readable back; injected at boot and every login shell into `boxd machine exec` and the preinstalled agents. Claude Code login is stored encrypted on your account and injected at boot on every machine.
- **Limits:** fixed shape 2 vCPU / 8 GiB / 100 GB (other sizes on request by email); 50 concurrent machines per org (2 until a card is added; forks/hibernated count); 25 API keys; API key -> 1-h JWT. Regions: not disclosed (EU company; pricing in EUR).
- **OSS/self-host:** self-host is the same single Rust binary (`boxd-ctl user set-quota` for quotas); licensing via contact. Source "pending". Ignition is AGPL-3.0 OSS.

## API / SDK (concrete)
- Languages: TypeScript `@boxd-sh/sdk`, Python `boxd`, raw gRPC (proto published; server reflection on, `grpcurl -plaintext boxd.sh:9443 describe boxd.api.v1.BoxdApi`), CLI (`curl -fsSL https://boxd.sh/downloads/install.sh | sh`), every CLI command accepts `--json`.
- Auth: `boxd auth login` (GitHub/Google); `export BOXD_API_KEY=$(boxd auth keys create my-app)`; keys are org-fenced; inside a machine `new Boxd()` is auto-authenticated.
```ts
import { Boxd } from "@boxd-sh/sdk";
const boxd = new Boxd();                                            // reads BOXD_API_KEY
const m = await boxd.machines.create({ name: "agent-1", isolated: true, fromSnapshot: "pi-golden" });
await boxd.machines.waitUntilReady(m.id);
const r = await boxd.machines.exec(m.id, { command: ["pi", "-p", "fix the failing test"] });
console.log(r.stdout);
const fork = await boxd.machines.fork("agent-1", { name: "agent-1b" });   // live clone
await boxd.snapshots.create(m.id, "pi-golden");                     // memory+disk image
await boxd.machines.checkpoints.create(m.id, "before"); await boxd.machines.checkpoints.restore(m.id, "before");
await boxd.machines.pause(m.id); await boxd.machines.resume(m.id);  // {suspend_us, resume_us}
await boxd.machines.delete(m.id);
```
```bash
boxd machine new agent-1 --isolated --from-snapshot pi-golden --auto-hibernate-timeout=0
boxd machine exec agent-1 --json -- pi -p "…"            # {"output":"...","exit_code":0}
boxd machine fork agent-1 --json                          # {"name":"agent-1-fork","boot":"161ms",...}
boxd machine cp ./repo agent-1:/home/boxd/repo            # file ops guide; downloads capped, uploads stream
boxd machine proxy set-port --vm agent-1 --port 3000      # https://agent-1.boxd.sh
boxd env set ANTHROPIC_API_KEY sk-… --secret --scope all
boxd machine remove agent-1 -y
```
- No custom images: machines boot the default Ubuntu 24.04 image; customise via a golden snapshot. Docker Engine/Compose/Buildx preinstalled.

## Workflow: end to end (for our factory)
1. `boxd machine new pi-golden`; `boxd connect pi-golden`; inside: install Node 24 + `npm i -g @earendil-works/pi-coding-agent`, clone repo, warm deps; write `~/.pi/agent/settings.json`; put `ANTHROPIC_API_KEY` etc. in `boxd env … --secret` (never bake into the image). `boxd snapshots save pi-golden pi-main`.
2. Per task: `boxd machine new task-N --from-snapshot pi-main --isolated --auto-hibernate-timeout=0` (or fork one warm machine 10x: 100–200 ms each). `boxd machine exec task-N -- 'cd repo && git checkout -b task-N && pi -p "…" --mode json'` — stream stdout; pi's JSONL session lands on the machine's disk under `~/.pi/agent/sessions`.
3. Collect: `boxd machine exec task-N -- git diff` / push branch via GitHub integration; or `boxd machine cp task-N:~/.pi/agent/sessions ./out`.
4. Teardown: `boxd machine remove task-N -y` (or let it hibernate: disk-only billing). Refresh golden on push to main via SDK (documented "golden image" guide).

## Pricing (fetched 2026-08-26, https://boxd.sh/pricing/)
- €0.049 / vCPU-h; €0.015 / GiB-h RAM; €0.0001 / GiB-h disk (used space). Default machine ≈ €0.22/h running. Standby bills RAM+disk; hibernated bills disk only. €30 free credits after adding a card; auto top-up €20.
- **Our estimate (fixed 2 vCPU / 8 GiB shape):** vCPU 1,760 h x €0.049 = **€86.24**; RAM 8 GiB x 880 h x €0.015 = **€105.60**; disk ~10 GiB used x 7,200 h x €0.0001 = **€7.20** → **≈ €199/mo (~$215)**. If 4 GiB machines were granted: RAM €52.80 → ≈ €146/mo. No plan fee. (Hibernated idle time ≈ free; standby idle would add RAM.)

## Notable techniques worth stealing
- Live fork with processes intact → fan out 10 attempts from one warm, indexed, dep-installed state in ~0.2 s each.
- Two-tier sleep (RAM standby vs disk hibernate) keyed to inbound traffic; `suspend_us`/`resume_us` reported in JSON.
- Checkpoint-as-undo before letting an agent loose; golden snapshot refreshed on every push to main.
- Org-scoped sealed secrets injected into every shell/exec so agents never see a `.env`.
- Per-machine `CLAUDE.md`/`AGENTS.md` telling agents how to use the platform CLI.

## Weaknesses / open questions / risks
- Not open source (yet); self-host license unpublished; small vendor, EU-based, pricing in EUR.
- One fixed machine shape (8 GiB you pay for even if you need 4); cap 50 machines.
- No egress allowlist / network policy — secrets exfiltration is only mitigated by sealing at rest.
- Auto-hibernate after 4 h of no *inbound* traffic could freeze a long `pi -p` run — set `auto-hibernate.timeout 0`.
- No custom base images (snapshot-only customisation); regions undisclosed.

## Fit for our agentic stack
- **pi preinstallable?** Yes — install Node 24 + pi in a golden machine, snapshot it; `boxd machine exec … pi -p` works exactly like their documented `claude -p` pattern. pi sessions persist on the 100 GB disk.
- **Verdict:** Strong technical fit (fastest fork in the field, persistent workspaces, pre-auth secrets) at ~€200/mo; the risks are vendor maturity and missing egress control. Good candidate if you want persistent, resumable agent workspaces rather than throwaway containers.

## Related resources mentioned
Ignition (lttle-cloud/ignition, AGPL), exe.dev (compared in blog), Tailscale integration, GitHub/Linear/Slack integrations.

## Key quotes / references
- "You create a new machine through copy on write in 100 to 200ms." — docs/guides/fork
- "Auto-hibernate … On by default, set to 4 hours … The idle timers watch network activity, not CPU." — docs/guides/suspend-resume
- "Source license is pending" — boxd.sh/blog/boxd-vs-exe-dev (2026-05-04)
- gRPC: "the public gRPC API at boxd.sh:9443 … server reflection … is enabled" — docs/reference/grpc-api

**Gaps:** could not verify a public source repo (azin-tech/boxd 404), self-host price, regions, or whether 4 GiB shapes are grantable. No HN thread found.

---

# Rivet sandbox-agent (+ Rivet agentOS / Actors)

- **URL:** https://github.com/rivet-dev/sandbox-agent — docs https://sandboxagent.dev/docs — API ref https://sandboxagent.dev/docs/api-reference — launch post https://rivet.dev/changelog/2026-01-28-sandbox-agent-sdk/
- **Type:** sandbox *control plane* (runs **inside** any sandbox; not a sandbox provider itself)
- **Author/Org:** Rivet (rivet.dev; also `rivet-dev/actors` 6.1k stars, Apache-2.0)
- **Researched:** 2026-08-26
- **Status/maturity:** 1,549 stars, Apache-2.0, Rust server + TS SDK, latest release v0.4.2 (2026-03-26), last push 2026-06-19. Beta-ish (OpenCode compat "experimental"), actively maintained, Discord.

## One-paragraph summary
A ~15 MB static Rust binary you drop into any sandbox (E2B, Daytona, Modal, Vercel, Cloudflare Containers, BoxLite, ComputeSDK, Docker, "Agent Computer") that exposes one HTTP + SSE API to drive Claude Code, Codex, OpenCode, Cursor, Amp **and pi** with a normalized event schema (messages, tool calls, permission requests, questions), plus file/process/terminal/desktop endpoints, an inspector UI, and a TypeScript SDK that can either spawn the daemon locally ("embedded") or connect to it remotely. Agents are installed lazily on first use via npm.

## Core ideas / thesis
- Every agent CLI has a different protocol; SSH breaks TTY/streaming; transcripts die with the sandbox → put one adapter server *in* the sandbox and stream a universal schema out to your own storage (Postgres/ClickHouse/Rivet Actors).
- Provider-agnostic: the `sandbox-agent/<provider>` helpers create the sandbox, install the binary, start the server, and connect.

## Architecture & mechanics
- Components: `sandbox-agent server` (Rust daemon, HTTP+SSE on :2468, `--token` or `--no-token`), TS SDK (`sandbox-agent` npm, embedded or server mode), CLI `@sandbox-agent/cli` mirroring the endpoints, Inspector at `/ui/`, OpenAPI spec (`docs/openapi.json`).
- Agent adapters speak **ACP** (Agent Client Protocol) — for pi the registry id/binary is `pi-acp` (`server/packages/agent-management/src/agents.rs`); installed with `sandbox-agent install-agent pi` (npm install under a managed root). Pi capabilities table: models `default` only; modes/thought levels "Unsupported" (docs/agents/pi.mdx). Its JSON schema is generated from pi-mono's `rpc-types.ts`.
- Sessions persist as event logs in the sandbox; SSE `GET /sessions/{id}/events?offset=` supports replay/reconnect. Session restoration and multiplayer documented.
- Isolation/cold-start/snapshot/pricing: **inherited from the host sandbox** (E2B provider: "Sandboxes pause by default instead of being deleted, and reconnecting with the same sandboxId resumes them").
- Security: run the client on your backend, not the browser; token header on every request; LLM credentials injected via `/llm-credentials` endpoints or env.

## API / SDK (concrete)
```bash
curl -fsSL https://releases.rivet.dev/sandbox-agent/0.4.x/install.sh | sh
sandbox-agent install-agent --all            # or: install-agent pi
sandbox-agent server --token "$SANDBOX_TOKEN" --host 0.0.0.0 --port 2468
# HTTP: POST /sessions  POST /sessions/{id}/messages  GET /sessions/{id}/events (SSE, ?offset=)  GET /sessions
#       GET /agents  POST /agents/{id}/install  files/processes/terminal(WS)/desktop  /mcp-config /skills /llm-credentials
sandbox-agent api sessions create s1 --agent pi --endpoint http://127.0.0.1:2468 --token "$SANDBOX_TOKEN"
sandbox-agent api sessions send-message-stream s1 --message "Add /health" --endpoint … --token …
```
```ts
import { SandboxAgent } from "sandbox-agent";
import { e2b } from "sandbox-agent/e2b";                    // also: daytona, vercel, modal, docker, local, boxlite, cloudflare
const sdk = await SandboxAgent.start({ sandbox: e2b({ template: "pi-template", create: { envs: { ANTHROPIC_API_KEY } } }) });
const session = await sdk.createSession({ agent: "pi" });
const res = await session.prompt([{ type: "text", text: "Fix the failing test" }]);
for await (const ev of sdk.streamEvents(session.id, { offset: 0 })) console.log(ev.type, ev.data);
await sdk.destroySandbox();
// remote: SandboxAgent.connect({ baseUrl: "https://<sandbox-host>:2468", token })
```
- Install: `npm install sandbox-agent@0.4.x` (Bun needs `bun pm trust @sandbox-agent/cli-*`). Skill: `npx skills add rivet-dev/skills -s sandbox-agent`.

## Workflow: end to end (for our factory)
Build the provider template (E2B/Daytona/Docker) with `sandbox-agent` binary + `sandbox-agent install-agent pi` pre-run + repo clone. Orchestrator (Node) does `Promise.all` over 10 `SandboxAgent.start({ sandbox: provider(...) })`, `createSession({agent:"pi"})`, `prompt(...)`, streams events into your DB (or a Rivet Actor per workspace), handles `permission` events, then reads the diff via the files/processes endpoints (`POST /processes` → `git diff`), and `destroySandbox()` (or pause). Cost = the provider's cost; sandbox-agent itself is free.

## Pricing
Free / Apache-2.0. Rivet's hosted Actors/agentOS have separate cloud pricing (not needed). **Est. monthly cost = your provider's** (e.g. E2B/Daytona ~$0.0504/vCPU-h + $0.0162/GiB-h → 1,760x0.0504 + 3,520x0.0162 ≈ **$146/mo** before storage).

## Notable techniques worth stealing
- Universal event schema + offset-replayable SSE log → transcripts survive the sandbox.
- One static binary as in-sandbox control plane; lazy agent install; per-provider `start()` helpers.
- ACP as the adapter protocol (pi already speaks it via `pi-acp`).

## Weaknesses / open questions / risks
- Pi adapter is thin (no modes/thought levels; docs page is 15 lines). Pi's own `--mode rpc` JSONL is arguably simpler for a pi-only factory.
- Extra moving part (HTTP server inside every sandbox; ingress URL/token exposure per sandbox).
- v0.4.x, last push June 2026 — check cadence before depending on it.

## Fit for our agentic stack
- **pi preinstallable?** Yes: `sandbox-agent install-agent pi` (npm) or bake pi into the image; `agent: "pi"` works today.
- **Verdict:** Useful *if* you want a multi-agent-capable, remote-controllable session API with permissions/questions and a debugger UI. For a pi-only factory it is optional; pi's own JSON/RPC modes over `exec` are enough.

## Rivet's own platform (relevance)
- **Rivet Actors** (`rivet-dev/actors`, Apache-2.0): durable stateful actors; docs show "sandbox orchestration" (one actor per workspace coordinating sandbox-agent sessions) and "sandboxed namespaces" for deploying AI-generated actor code — not a Linux VM sandbox.
- **agentOS** (https://rivet.dev/agent-os/, `npm i @rivet-dev/agentos`, Apache-2.0): in-process "OS" on WebAssembly + V8 isolates (bash, Node, Python, git, sqlite… from a registry); claims 4.8 ms cold start, ~22 MB/instance. Not a full Linux kernel — pi (Node) might run, but native toolchains/Docker won't. Treat as a cheap ephemeral-tool sandbox, not the agent host.

## Key quotes / references
- "Lightweight static Rust binary. One curl command to install inside E2B, Daytona, Modal, Cloudflare Containers, Agent Computer, or Docker" — README
- "Single interface to control Claude Code, Codex, OpenCode, Cursor, Amp, and Pi with full feature coverage" — README

**Gaps:** exact endpoint list beyond the core (copied from README/API-ref summary); pi adapter feature parity not tested; hosted Rivet pricing not fetched.

---

# AgentBox — two different projects

## (a) agentbox-sdk (TwillAI) — the one in the dev.to article
- **URL:** https://github.com/TwillAI/agentbox-sdk — npm `agentbox-sdk` — article https://dev.to/gentic_news/run-claude-code-in-any-sandbox-with-one-api-agentbox-sdk-3ibb — demo agentbox-demo-175164121374.us-west1.run.app
- **Type:** sandbox abstraction SDK (TypeScript)
- **Author/Org:** Twill (twill.ai)
- **Status/maturity:** 163 stars, 18 forks, MIT (package.json; no LICENSE file detected by GitHub), v0.1.501, last push 2026-07-13. Early.
- **Summary:** "One API for any agent + any sandbox provider." Launches the agent as a *server process* inside the sandbox and talks WebSocket/HTTP to keep approval flows and streaming. Agents: `claude-code`, `opencode`, `codex` (no pi). Providers: `local-docker`, `e2b`, `modal`, `daytona`, `vercel`. Node >= 20; agent CLIs must be in the image.
```ts
import { Agent, Sandbox } from "agentbox-sdk";
const sandbox = new Sandbox("e2b", { workingDir: "/workspace", image: process.env.IMAGE_ID!, env: { ANTHROPIC_API_KEY } });
await sandbox.findOrProvision();
const run = new Agent("claude-code", { sandbox, cwd: "/workspace", approvalMode: "auto" }).stream({ model: "sonnet", input: "Create a hello world Express server" });
for await (const e of run) if (e.type === "text.delta") process.stdout.write(e.delta);
await sandbox.delete();
```
- **Snapshots:** Vercel provider: `sandbox.snapshot()` → pass id as `provider.snapshotId`. Otherwise provider-dependent.
- **Pricing:** free; cost = provider.
- **Fit:** pi not supported as an agent; adding an adapter would be the work. Low priority.

## (b) madarco/agentbox — the one in the wincent gist comments
- **URL:** https://github.com/madarco/agentbox — https://agent-box.sh — npm `@madarco/agentbox`
- **Type:** CLI that moves your project into a sandboxed box (local or cloud) and runs agents there in parallel
- **Author/Org:** madarco (solo dev)
- **Status/maturity:** 375 stars, 30 forks, 1,371 commits, MIT, last push 2026-08-26 (very active). Requires macOS/Linux, Docker Desktop/OrbStack, Node >= 20.10.
- **Summary:** `agentbox create` = Docker container with a **FUSE overlay** of your project (host files stay untouched until you accept), plus persistent shells, browser/screen share, VS Code/Cursor preconfigured. Backends: local docker, remote docker over SSH (`docker commit` snapshots), **Hetzner**, **Daytona** (snapshots experimental), **Vercel**, **E2B** (Dockerfile via `Template.build()`), **DigitalOcean**; pluggable provider SDK. **Checkpoints:** "Sub <1s startup of new boxes from a previous checkpoint, auto pause to save cost". Git credentials stay local; pushes require permission. Agents: Claude Code, Codex, OpenCode (skills/plugins/settings carried over).
```bash
npm i -g @madarco/agentbox
agentbox hetzner login            # token → ~/.agentbox/secrets.env  (also vercel|daytona|e2b)
agentbox prepare --provider hetzner   # build image + initial snapshot
agentbox hetzner claude           # box up + run Claude Code;  agentbox create | attach | shell | url | checkpoint create | stop | destroy
```
- **Pricing:** free; Hetzner backend makes it the cheapest cloud path (e.g. CX/CPX VPS at a few EUR/month each — exact SKU not verified here).
- **Fit:** pi is not a built-in agent, but a box is a normal container/VM: `agentbox shell` → `npm i -g @earendil-works/pi-coding-agent && pi -p …` works. Good *interactive* solo-dev tool; less of an orchestration API (CLI-driven, per-project).

**Gaps (both):** no benchmarks, no security review; TwillAI LICENSE file absence unverified beyond GitHub metadata.

---

# Other notable OSS / self-host / small-vendor options (compact)

**Gondolin (earendil-works/gondolin) — pi's own micro-VM.** https://github.com/earendil-works/gondolin — 2,035 stars, Apache-2.0, TS, last push 2026-07-06, "experimental". Local Linux micro-VMs via **QEMU** (default) or experimental **krun/libkrun** backend, ARM64 best tested; TypeScript control plane with programmable **HTTP/TLS egress policy** (`createHttpHooks({ allowedHosts: ["api.github.com"], secrets: { GITHUB_TOKEN: … } })`) where the guest only ever sees placeholder tokens and the host injects real secrets for allowed destinations; ingress gateway (`vm.enableIngress()` / `--listen`); **disk checkpoints** (`snapshot <session>` / `bash --resume <id>`), no live memory fork. Ships `host/examples/pi-gondolin.ts`: a pi extension (`pi -e …/pi-gondolin.ts`) that overrides pi's `read/write/edit/bash` tools to run inside the VM with cwd mounted at `/workspace`. Free; runs where QEMU/KVM or Hypervisor.framework exists — on a cloud host you need nested virt (bare-metal Hetzner/OVH or KVM-capable VPS). **pi: yes, natively.** Best "steal": secret-placeholder egress proxy.

**Northflank Sandboxes.** https://northflank.com/sandboxes — hosted PaaS + self-serve **BYOC** (AWS/GCP/Azure/Oracle/CoreWeave/bare-metal). Isolation per workload: **Kata Containers with Cloud Hypervisor, Firecracker, or gVisor** on K8s. ComputeSDK benchmark (Jul 2026): 97 ms sequential / 167 ms median burst cold start; 100k concurrent sandboxes in 24 s. Persistent or ephemeral, no forced time limit; snapshots mentioned but not detailed. Not OSS (team contributes to Kata/QEMU/CLH). Pricing (2026-05-05 blog): **$0.01667/vCPU-h, $0.00833/GB-h, $0.15/GB-mo** → our basis: 1,760x0.01667 = $29.34 + 3,520x0.00833 = $29.32 + 100 GB x $0.15 = $15 → **≈ $74/mo**, cheapest managed option found. API/SDK: REST + JS SDK/CLI (docs page fetch failed). **pi: yes** (any Docker image; run `pi -p` via exec/job).

**NVIDIA OpenShell.** https://github.com/NVIDIA/OpenShell — 8,378 stars, Apache-2.0, Rust, pushed 2026-08-26, docs https://docs.nvidia.com/openshell/latest/. "Safe, private runtime for autonomous AI agents": sandboxes run on compute drivers Docker/Podman/**MicroVM**/Kubernetes (Helm, experimental) with declarative YAML policy — filesystem (Landlock) and process/syscall (seccomp) locked at creation, hot-reloadable **network policy down to HTTP method/path**, inference rerouting to managed backends, OCSF audit export. `openshell sandbox create -- claude`, `openshell policy set name --policy p.yaml`, `openshell term` TUI. Agents supported unmodified: Claude Code, OpenCode, Codex, Copilot CLI; NemoClaw (22k stars) is the reference stack. Self-hosted only; Linux/macOS (Apple Silicon)/WSL2. No snapshot/fork documented. **pi: yes in principle** (bring your own containerized runtime / community sandbox images) — unverified. Steal: policy-as-YAML with method/path-level egress.

**Dagger container-use.** https://github.com/dagger/container-use — 4,021 stars, Apache-2.0, Go, pushed 2026-08-17, "experimental". MCP server + CLI: each agent gets a fresh Docker container (via Dagger) **and its own git branch**; review with `git checkout <branch>`, full command history/logs, discard failures. Install `curl -fsSL https://raw.githubusercontent.com/dagger/container-use/main/install.sh | bash`. Container isolation only (shared kernel), no memory snapshots, local-Docker oriented (a remote Docker host works). **pi: yes** as MCP client, or just point pi's bash at the env — but pi has native worktree/branch flows, so the value is mostly the Docker isolation + branch-per-agent convention. Steal: branch-per-environment + captured command log.

**microsandbox.** https://github.com/superradcompany/microsandbox — 7,943 stars, Apache-2.0, Rust, pushed 2026-08-26; docs https://docs.microsandbox.dev. Local-first **libkrun** microVMs (own kernel), boots "under 100 ms" on Apple Silicon (gist: sub-200 ms), embeddable SDKs (TS/Rust/Python/Go/Ruby, no daemon: `Sandbox.builder("x").image("python").cpus(1).memory(512).create()` → `sandbox.exec(...)`), `msb` CLI (`run/create/exec/stop/start/rm/pull/ps/metrics`), MCP server, "warm workers" cache; a hosted cloud "same SDK, API key is the only change" (pricing not published). Needs macOS Apple Silicon, Linux with KVM, or Windows WHP → cloud use needs nested-virt hosts. Snapshot/fork not documented. **pi: yes** (OCI image with Node 24 + pi).

**Blaxel.** https://blaxel.ai — hosted microVM sandboxes (own VMM), "boot in milliseconds", **resume ~25 ms** from standby; idle sandboxes auto-suspend and suspended time is free; SDKs Python/TypeScript (MIT on GitHub: blaxel-ai/sdk-python, sdk-typescript, sandbox 28 stars — SDKs OSS, platform not). Pricing: **$0.0000115 per GB-RAM-second active** (= $0.0414/GB-h, CPU bundled), snapshots $0.20/GB-mo, images $0.045/GB-mo, volumes $0.12/GB-mo; $200 free credits, Tier 0 ≤ 10 sandboxes. Our basis: 4 GB x 880 h x $0.0414 = **≈ $146/mo** (+ snapshots). Custom images supported. **pi: yes** (custom image). Note: the 10-sandbox free-tier cap exactly equals our concurrency.

**Hopx.** https://hopx.ai — docs https://docs.hopx.ai — GitHub hopx-ai/hopx 333 stars MIT (SDK/examples; platform closed), pushed 2026-07-09. **Firecracker** microVM per sandbox, ~100 ms start "from snapshots", full state persistence, SDKs Python/JS/Go + MCP (hopx-ai/mcp 155 stars), desktop/VNC, background processes, file watch. Pricing (per-second): **$0.0504/vCPU-h, $0.0162/GiB-h, $0.000108/GiB-h storage**, no idle charges, **$200 free credits no card**. Our basis: $88.70 + $57.02 + 10 GiB x 7,200 h x 0.000108 = $7.78 → **≈ $153/mo** (E2B/Daytona-identical rates). Custom templates/egress control not verified. **pi: likely yes** (custom template) — unverified.

**Together Code Sandbox / CodeSandbox SDK.** https://docs.together.ai/docs/together-code-sandbox — SDK repo https://github.com/codesandbox/codesandbox-sdk (111 stars, TS, no license detected, pushed 2026-06-18). Firecracker microVMs with **memory snapshots: fork/resume ≈ 0.5–1 s**, hibernate on idle, up to 64 vCPU, persistent IDE-style VMs; CodeSandbox joined Together AI. Pricing (together.ai/pricing, fetched): **$0.0446/vCPU-h, $0.0149/GiB-h**, storage $0.16/GiB-mo; CodeSandbox credit model: Nano VM = 10 credits/h at $0.015/credit = $0.15/h (Nano spec not verified; Micro/Small tiers not fetched). Our basis (Together rates): 1,760x0.0446 = $78.50 + 3,520x0.0149 = $52.45 + ~$16 storage → **≈ $147/mo**. **pi: yes** (custom Dockerfile templates).

**Runloop Devboxes.** https://www.runloop.ai — SDKs Python/TypeScript (runloopai/api-client-ts MIT). microVM devboxes, blueprints (images) + snapshots, suspend = storage-only billing. Pricing (fetched): **$0.108/CPU-h, $0.0252/GB-h**, devbox storage $0.00034236/GB-h, snapshot/blueprint storage $0.000072/GB-h; Basic plan $0/mo, Pro $250/mo; $50 free credits; trial limits 3 running devboxes / 10 snapshots. Our basis: 1,760x0.108 = $190.08 + 3,520x0.0252 = $88.70 + storage ~$25 → **≈ $304/mo** on Basic — roughly 2x E2B-class pricing; enterprise-oriented. **pi: yes** (blueprint Dockerfile).

**Morph Cloud (Infinibranch).** https://cloud.morph.so — SDKs Python/TypeScript (morph-labs/morph-python-sdk, morph-typescript-sdk; tiny star counts). Whole-VM **memory snapshot + branch/restore in <250 ms** ("Infinibranch"), devboxes as workspaces, EFS mountable storage, Responses-proxy. Pricing in **MCU**: 1 MCU = 1 vCPU-h + 4 GB-h + 16 GB-disk-h (or 5 TB snapshot-h); devbox MCU/h = max(vCPU, ceil(RAM/4), ceil(disk/16)); **$0.05/MCU-h**; plans Free (300 MCU), Developer $40/mo (1,000 MCU), Team $250/mo (7,500 MCU). Our basis: 2 MCU/h (2 vCPU, 4 GB, ≤32 GB disk) x 880 h = 1,760 MCU x $0.05 = **≈ $88/mo PAYG** (or $40 + 760 x 0.05 = $78 on Developer). Snapshots cheap (8 GB snapshot ≈ $0.12/mo). Not OSS. **pi: yes** (snapshot a VM with pi installed, branch it 10x).

---

# Comparison snapshot (this file)

| Option | Isolation | Cold start | Fork/snapshot | Egress ctl | OSS / self-host | Est. $/mo (10x2vCPU/4GB, 4h/d) | pi |
|---|---|---|---|---|---|---|---|
| boxd | KVM microVM | ~6 ms new; 100–200 ms fork | live memory fork, mem+disk snapshot, checkpoint, standby/hibernate | none | closed (self-host binary, license TBD) | ≈ €199 (8 GiB shape) | yes (golden snapshot) |
| sandbox-agent | inherits provider | n/a | n/a | n/a | Apache-2.0 | provider cost (~$146 on E2B) | yes (`agent:"pi"`, ACP) |
| agentbox-sdk (Twill) | provider | n/a | Vercel snapshot | n/a | MIT | provider cost | no adapter |
| agentbox (madarco) | Docker+FUSE / cloud VM | <1 s from checkpoint | checkpoints | n/a | MIT | Hetzner VPS cost | manual |
| Gondolin | QEMU/krun microVM | n/a (local) | disk checkpoint | **allowlist + secret placeholders** | Apache-2.0 | host cost | yes, native |
| Northflank | Kata/CLH/Firecracker/gVisor | ~100–170 ms | snapshots (undetailed) | yes (network policies) | closed; BYOC | ≈ $74 | yes |
| OpenShell | container/microVM + Landlock/seccomp | n/a | none | **YAML, method/path** | Apache-2.0 | host cost | likely |
| container-use | Docker | s | none (git branch) | no | Apache-2.0 | host cost | yes/MCP |
| microsandbox | libkrun microVM | <100–200 ms | none doc'd | no | Apache-2.0 | host cost | yes |
| Blaxel | microVM | ms; 25 ms resume | standby/snapshots | ? | SDKs MIT | ≈ $146 | yes |
| Hopx | Firecracker | ~100 ms | snapshots | ? | SDK MIT | ≈ $153 | likely |
| Together/CodeSandbox | Firecracker | 0.5–1 s resume | memory snapshot + fork | ? | SDK OSS | ≈ $147 | yes |
| Runloop | microVM | s | blueprints + snapshots | ? | SDK MIT | ≈ $304 | yes |
| Morph Cloud | microVM | <250 ms branch | **Infinibranch** mem snapshot/branch | ? | SDK OSS | ≈ $88 | yes |
