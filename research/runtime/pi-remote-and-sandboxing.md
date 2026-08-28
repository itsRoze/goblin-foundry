# pi remote sessions & sandboxing — Docker, Gondolin, OpenShell, pi-server/client/protocol

- **URLs:** https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/containerization.md (= https://pi.dev/docs/latest/containerization) · `packages/{server,client,protocol}/README.md` · `packages/coding-agent/src/server/create-harness.ts` · `packages/coding-agent/examples/extensions/{gondolin,sandbox,ssh.ts,rpc-demo.ts}` · https://github.com/earendil-works/gondolin · https://github.com/NVIDIA/OpenShell · https://github.com/earendil-works/pi-chat
- **Type:** sandbox + runtime protocol
- **Author/Org:** Earendil (pi, Gondolin, pi-chat); NVIDIA (OpenShell)
- **Researched:** 2026-08-26
- **Status/maturity:** containerization doc is official and current. Gondolin 2,035★, Apache-2.0, last push 2026-07-06, self-described "Experimental". OpenShell 8.4k★, Apache-2.0, very active (2026-08-26), pi is a first-class supported agent (`openshell sandbox create --from pi`). `pi-server`/`pi-client`/`pi-protocol`: "Experimental … may change or be removed without notice"; **no CLI or reference service ships** — you implement `PiServerService`. pi-chat 386★, Apache-2.0, last push 2026-06-05.

## One-paragraph summary

pi has no in-process permission system; the documented isolation options are (1) run the whole pi process in **Docker**, (2) keep pi on the host and relocate its tools into a **Gondolin** micro-VM via the bundled extension, or (3) wrap pi in an **OpenShell** policy-enforced sandbox (local Docker/Podman/VM gateway or remote Kubernetes gateway) which also keeps model API keys outside the sandbox via inference routing. For driving many agents, today's practical seams are the **RPC mode** (`pi --mode rpc`, JSONL over stdio — any language, one process per session), the **SDK** (`createAgentSession` in-process), and the experimental **pi-server/pi-client/pi-protocol** stack (length-prefixed CBOR, session leases, authoritative snapshots, Unix-socket or WebSocket listeners) which is the intended long-term multi-session remote seam but currently requires you to write the service layer. pi-chat is the only Earendil reference that runs a fleet: one Gondolin VM + one pi session per chat channel, managed as detached tmux workers with 15-second status snapshots.

## Core ideas / thesis

- "Security is the container/VM's job": pi runs YOLO; the boundary is outside the agent.
- Prefer **tools-in-VM, agent-on-host** (Gondolin): provider credentials and session files never enter the guest; the guest sees only `/workspace` and placeholder secrets.
- Remote protocol design: **server is authoritative** (snapshots), progress events are "transient UI hints", session access is a **lease** (exclusive for the mutation coordinator, shared for observers), auth happens at transport establishment, not in the protocol.

## Architecture & mechanics

### 1. Docker (whole process in container)

```dockerfile
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates git ripgrep \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent
WORKDIR /workspace
ENTRYPOINT ["pi"]
```
```bash
docker build -t pi-sandbox -f Dockerfile.pi .
docker run --rm -it -e ANTHROPIC_API_KEY -v "$PWD:/workspace" -v pi-agent-home:/root/.pi/agent pi-sandbox
```
Named volume for `/root/.pi/agent` keeps container-local settings; never bind-mount the host agent dir (auth.json). Headless variant: replace `-it` with `-i` and pass `--mode rpc` / `--mode json -p`. Egress control must be done at the Docker network layer (none built in).

### 2. Gondolin (micro-VM; tools relocated, pi on host)

```bash
cp -R packages/coding-agent/examples/extensions/gondolin ~/.pi/agent/extensions/gondolin
cd ~/.pi/agent/extensions/gondolin && npm install --ignore-scripts
cd /path/to/project && pi -e ~/.pi/agent/extensions/gondolin
```
Requires Node ≥ 23.6 and QEMU (macOS: `brew install qemu node`; Linux: `qemu-system-arm nodejs npm`; optional libkrun backend). The extension (`examples/extensions/gondolin/index.ts`) does:

```ts
import { RealFSProvider, VM } from "@earendil-works/gondolin";
const created = await VM.create({ vfs: { mounts: { [GUEST_WORKSPACE /* "/workspace" */]: new RealFSProvider(localCwd) } } /*, httpHooks, env */ });
const bashProbe = await created.exec(["/bin/sh", "-lc", "command -v bash || true"]);
// bash tool:
const proc = vm.exec([shellPath, "-lc", command], { /* signal, cwd */ });
// then pi.registerTool({ name: "read" | "write" | "edit" | "bash" | "grep" | "find" | "ls", ... }) — 7 overrides
```
Gondolin host-side features usable from that extension: `createHttpHooks({ allowedHosts: ["api.github.com"], secrets: { GITHUB_TOKEN: { hosts: ["api.github.com"], value: process.env.GITHUB_TOKEN } } })` — the guest sees a **placeholder** and the host swaps in the real token only for allowlisted hosts; rootfs modes `readonly | memory | cow`; programmable VFS mounts in JS; DNS modes; ingress gateway; `npx @earendil-works/gondolin snapshot <session-id>` / `--resume <snapshot>`; `list` / `attach`. Alpine guest with bash.

### 3. OpenShell (policy-enforced sandbox around the whole agent)

```bash
openshell gateway add <gateway-url> --name <name> && openshell gateway select <name>
openshell sandbox create --name pi-sandbox --from pi -- pi          # pi image maintained in OpenShell Community repo
openshell sandbox upload pi-sandbox ./repo /workspace                # remote gateways
openshell sandbox download pi-sandbox /workspace/repo ./repo-out
openshell policy set …                                               # network/inference sections hot-reloadable
```
Declarative YAML policy: filesystem + process sections locked at creation; network + inference sections hot-reloadable. Credentials are "providers" injected as env at runtime, never written to the sandbox fs; **inference routing** lets the sandbox call models through the gateway so "OpenShell providers can keep raw model API keys outside the sandbox". Backends: local Docker/Podman/VM gateway, or remote Kubernetes gateway — i.e. a managed fleet substrate exists here already. Supported agents: Claude Code, OpenCode, Codex, Copilot CLI, OpenClaw, Hermes, Ollama, **Pi**.

### 4. Bundled lighter options

- `examples/extensions/sandbox/` — wraps `bash` in `sandbox-exec` (macOS) / bubblewrap (Linux) with `~/.pi/agent/extensions/sandbox.json` + `.pi/sandbox.json` (allowed domains, denied reads `~/.ssh ~/.aws`, denied writes `.env*`).
- `examples/extensions/ssh.ts` — tool override that executes on a remote host over SSH (same `operations` injection idea as Gondolin) → cheapest "worker VM" integration: pi on the controller, tools on the VM.
- `examples/extensions/rpc-demo.ts` — shows RPC usage.

### 5. Driving sessions headlessly — the three seams

| seam | transport | multi-session | who implements what | status |
|---|---|---|---|---|
| `pi --mode rpc [--no-session]` | JSONL on stdin/stdout, one process per session | one per process | you: spawn + parse; commands `prompt/steer/follow_up/abort/get_state/get_messages/get_entries/get_tree/new_session/switch_session/fork/set_model/set_thinking_level/bash/compact/get_session_stats/export_html`; `extension_ui_request`↔`extension_ui_response` lets the controller answer `select/confirm/input` dialogs | stable, documented |
| SDK `createAgentSession()` / `createAgentSessionRuntime()` | in-process TS | many in one Node process | you: host process | stable |
| `pi-server` + `pi-client` + `pi-protocol` | 4-byte BE length + CBOR frame (16 MiB, depth 64); Unix socket or WebSocket listener | many, with leases | you: `PiServerService { listSessions(); listModels(); createSession(options); openSession(id) }` + `PiServerListener` for auth | experimental |

pi-server:
```ts
import { createUnixServer } from "@earendil-works/pi-server";
const server = createUnixServer(service, { path: "/tmp/pi/server.sock" }); await server.start();
```
`PiServerService` returns durable `SessionMetadata` (id, createdAt, updatedAt, parentSessionId, sessionName, cwd); dynamic state (phase, model, thinking, attachments, locks) comes from live snapshots. Adapters `toProtocolAssistantMessage()` etc. map `pi-ai` objects to wire DTOs. `@earendil-works/pi-server/testing` gives `createTestServer()`, `TestServerService`, `ProtocolTestClient`, `WireChannel` conformance harness. `src/server/create-harness.ts` (`createCodingAgentHarness({ env: ExecutionEnv, bashCommandPrefix, sessionFile, tools?, activeToolNames?, systemPrompt? })`) builds the default read/bash/edit/write tools over an `ExecutionEnv` and sets `PI_SESSION_ID/PI_SESSION_FILE/PI_PROVIDER/PI_MODEL/PI_REASONING_LEVEL` for bash children — this is the piece that binds an `AgentHarness` from `pi-agent-core` to the server, and `ExecutionEnv` is the abstraction to point at a VM.

pi-client:
```ts
import { PiClient } from "@earendil-works/pi-client";
import { createUnixTransportFactory } from "@earendil-works/pi-client/unix";
const client = new PiClient({ transportFactory: createUnixTransportFactory({ path: "/tmp/pi.sock" }), maxFrameLength });
await client.connect();
const session = await client.createSession({ cwd: "/workspace" });        // exclusive SessionLease
// or client.acquireSession(id, "exclusive" | "shared") / client.attachSession(id)
const off = session.subscribe((snapshot) => render(snapshot));               // authoritative
session.onEvent((e) => …);                                                   // transient progress
await session.prompt("Inspect this project");
await session.detach(); // or dispose(); AsyncDisposable
```
Lease semantics: `exclusive` = single lifecycle/mutation coordinator (fails if any lease exists); `shared` = observers (fails if an exclusive exists). Errors: `PiDisconnectedError`, `PiSessionDetachedError`, `PiSessionOwnershipError`, `PiServerError`. First client message is always `hello {version: PROTOCOL_VERSION}`. Transport factory does auth before resolving; WebSocket auth at HTTP upgrade; Unix relies on fs perms. Client has no Node deps (browser-capable) — the dashboard story.

### 6. pi-chat — the only official "fleet" reference

"Each connected channel gets its own Gondolin micro-VM with persistent workspace, shared storage, memory, and skills" (Alpine, `/workspace` + `/shared`). Everything under `~/.pi/agent/chat/`; per-channel encrypted secrets. Workers are detached `tmux` + pi sessions: `/chat-spawn-all`, `/chat-workers`, `/chat-open-all` (tiled dashboard), `/chat-kill-all`; "Workers also write status snapshots every 15 seconds" to `~/.pi/agent/chat/worker-status/`. Remote control from chat: `stop`, `status`, `compact`, `new`. Sessions are driven in-process via the SDK with tools routed into the VM.

## Workflow: end to end — driving a fleet of pi agents in cloud VMs from one controller

Three viable topologies, ordered by maturity:

**A. Agent-in-VM, controller speaks RPC over SSH/exec (works today).**
1. Controller creates VM (image = Dockerfile above or exeuntu/`--from pi`), pushes worktree, injects a scoped inference key (Inkwell's `sbx-` pattern) or points pi at an LLM gateway via `models.json` / `before_provider_headers`.
2. Controller runs `ssh vm 'cd /workspace && pi --mode rpc --no-session -e /opt/factory-ext'` (or `docker exec -i`, or OpenShell `sandbox exec`), keeps the pipe, sends `{"type":"prompt","message":…}`, streams events, answers `extension_ui_request` (approval gates), calls `get_session_stats` for cost, `export_html` for provenance.
3. Worker extension (`/opt/factory-ext`) enforces `tool_call` policy, writes `pi.appendEntry("factory/…")` checkpoints, exposes `run_tests`/`open_pr`, and uses `terminate:true` structured output for the final envelope.
4. Session JSONL stays on the VM; controller pulls it (or `--session-dir` on a mounted volume) plus `git bundle` for results.
   Pros: one process per task, any language for the controller, no experimental packages. Cons: N SSH pipes, reconnect/resume logic is yours (`--session <file>` + `-c` on restart).

**B. Agent-on-controller, tools-in-VM (Gondolin/SSH tool override).**
Controller Node process hosts N `createAgentSession()`s; each gets an extension overriding `read/write/edit/bash/grep/find/ls` to a per-task Gondolin VM (`RealFSProvider` on a per-task worktree, `createHttpHooks` allowlist + placeholder secrets) or a remote box via `ssh.ts`. Sessions, auth, and telemetry stay central; the guest never sees credentials.
Pros: strongest secret hygiene, snapshot/resume VMs, single place for cost caps. Cons: Gondolin needs QEMU/krun on the controller host (local or one big cloud box), experimental; N model streams through one process.

**C. pi-server per VM (or one central pi-server) + pi-client controller/dashboard (future).**
Implement `PiServerService` whose `createSession({cwd})` builds `createCodingAgentHarness({ env })` with an `ExecutionEnv` bound to the task's VM/worktree; expose over WebSocket with token auth at upgrade; controller holds `exclusive` leases, a browser dashboard attaches `shared`. Snapshots give authoritative state for reconnects; SQLite session backend + FTS for search.
Pros: designed for exactly this (leases, snapshots, browser client). Cons: experimental, no reference service, protocol may change; budget for tracking upstream.

Recommended path: **A now, with the worker extension written so it also works in-process (B) and later behind a `PiServerService` (C)** — the extension API is the same in all three.

## Notable techniques worth stealing

- Placeholder secrets + host-side HTTP hooks (Gondolin) — the guest can `git push` without ever holding a token.
- OpenShell inference routing: model keys stay at the gateway; policy network/inference sections hot-reloadable on running sandboxes.
- `ExecutionEnv` / `operations` injection in `create-harness.ts` and built-in tool factories — swap the execution backend without changing the model-facing tool schema.
- Lease model (exclusive coordinator + shared observers) and "snapshots authoritative, events transient" — copy into our own controller protocol even if we don't use pi-protocol.
- `extension_ui_request` over RPC — human/controller-answerable approval gates in headless mode.
- pi-chat's 15-second worker status snapshot files + tmux-detached workers — trivial liveness for a solo-dev fleet.
- `PI_SESSION_ID`/`PI_SESSION_FILE` env in bash children → any script the agent runs can tag telemetry with the session.

## Weaknesses / open questions / risks

- pi-server/client/protocol are explicitly unstable and have **no shipped service, CLI, or auth implementation**; conformance tests exist but you own the service.
- Gondolin requires QEMU/libkrun on the host — awkward inside a cloud VM unless nested virt; better suited to a single beefy controller box or local dev.
- Docker route provides no egress policy or secret scoping by itself.
- OpenShell adds a gateway/K8s dependency and NVIDIA governance; pi image is "community" maintained.
- Session portability (Earendil post "The Session You Cannot Take With You", 2026-07-30) and the v4/SQLite session work are in flight — remote-session semantics may shift.
- RPC framing gotcha: split on `\n` only; multi-line JSON breaks Node `readline` consumers.

## Fit for our agentic stack

Use topology **A** for the first factory: cloud VM per task (exe.dev/Sprites/Docker host), pi installed in the image, controller opens `pi --mode rpc` over SSH or the provider's exec API, our `@goblin-foundry/pi-factory` extension inside. Put secrets behind a gateway (OpenRouter-style capped per-run key or an LLM proxy via `models.json`) and give the VM a GitHub token only through a push proxy (Gondolin-style placeholder) or short-lived installation token. Evaluate OpenShell's remote gateway as a drop-in fleet substrate once we need policy hot-reload or K8s. Track `pi-server` for the dashboard/lease layer and plan to implement `PiServerService` when it stabilises; prototype the dashboard on pi-web or a `--mode json` tail in the meantime.

## Related resources mentioned

- https://github.com/earendil-works/gondolin — VM API, http hooks, snapshots.
- https://github.com/NVIDIA/OpenShell + https://docs.nvidia.com/openshell/sandboxes/policies + supported-agents page — policy YAML, providers, remote K8s gateway; pi image in OpenShell Community repo.
- https://docs.openclaw.ai/gateway/openshell — OpenClaw (pi-based) running under OpenShell; likely has fleet-ish config.
- `packages/coding-agent/examples/extensions/ssh.ts`, `rpc-demo.ts`, `sandbox/` — read before writing our tool-override extension.
- https://earendil.com/posts/session-portability/ — rationale for remote/portable sessions.
- exe.dev `exeuntu` image (pi preinstalled) — see research/sandbox/exe-dev.md.

## Key quotes / references

- "Experimental. This package is under active development and may change or be removed without notice." — pi-server README
- "Listeners complete transport-specific authentication and authorization before passing a connection to PiServer." — pi-server README
- "Progress events are transient UI hints; separate authoritative state" — pi-protocol README
- "OpenShell providers can keep raw model API keys outside the sandbox." — containerization.md
- "Each connected channel gets its own Gondolin micro-VM…" / "Workers also write status snapshots every 15 seconds" — pi-chat README

## Gaps / not verified

- Did not read `ExecutionEnv` definition in `pi-agent-core` or the WebSocket listener implementation in `pi-server` (only the Unix preset is documented).
- Gondolin README did not detail multi-VM/daemon management beyond `list`/`attach`; whether it can run inside a cloud VM (nested virt) untested.
- OpenShell policy YAML for the pi image and the remote gateway's per-sandbox API were not read.
- pi-chat's exact SDK wiring (`createAgentSession` + Gondolin tools) inferred from README.
- Session-dir behaviour when pi runs in a container with `--mode rpc` and the controller wants to resume after VM restart: untested.
