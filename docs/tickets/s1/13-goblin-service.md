# 13: `goblin service` — the tracker runs without a dev server

**What to build:** Goblin has to be up whenever I am working, and I am mostly working in other repositories. Today that means a `bun dev` left running in this checkout. Replace it with a macOS LaunchAgent that keeps the one API process (`api/src/server.ts`, serving the built GUI from `web/dist`) alive across logins and crashes, managed from the CLI as a new non-client noun: `goblin service install | uninstall | start | stop | restart | status | logs`. `install` builds the GUI (`bun run build`), writes `~/Library/LaunchAgents/dev.goblin-foundry.plist` (`RunAtLoad`, `KeepAlive`, `WorkingDirectory` = this checkout, `ProgramArguments` = `/opt/homebrew/bin/bun` and the absolute path to `server.ts`, stdout/stderr to `~/.goblin-foundry/logs/service.{out,err}.log`), and loads it. `restart` rebuilds the GUI first, so it is also how a change to Goblin itself reaches the running tracker. `status` says whether the agent is loaded, whether the port answers, and which checkout and database it runs against.

**Decisions (grilled 2026-09-17):** Not Docker. The process is localhost-only, single-user and unauthenticated by design (ADR-0004), so there is nothing to isolate; Docker Desktop would be a bigger always-on than the process it replaces; SQLite on a bind mount through the macOS VM is a known locking footgun; and `goblin backup` reads the database file directly on the host (ADR-0001's carve-out). launchd is what ADR-0001 already assumed for backups and what the laptop's Homebrew services already use; ticket 09 only deferred it. The service runs from the checkout (no compiled binary): the plist pins the checkout path and the stable `/opt/homebrew/bin/bun` symlink, never the Cellar path, so a bun upgrade cannot break it; a moved checkout is fixed by running `install` again. The service always uses the default database, `~/.goblin-foundry/foundry.db`, with no option to choose another — the service is the one real tracker, and `goblin backup` reads the same path with no env to reconcile; a different database means a server started by hand with `GF_DB_PATH` on another port. `RunAtLoad` + `KeepAlive`: up at login, relaunched on any exit. `stop` unloads for this login session only (`launchctl bootout`) and the agent returns at next login; `uninstall` is the permanent off. `install` is idempotent (rewrite plist, build, reload); `restart` is `install` minus the plist write; a failed GUI build aborts `restart` and leaves the running process alone; `bun install` stays a human step. The service and `bun dev` share port 4747: `server.ts` catches the busy-port error and prints one line naming `goblin service stop` and `GF_PORT`; `bun dev` keeps 4747 so the CLI and Playwright defaults never diverge from what is being hacked on. The CLI's unreachable hint (exit `3`) changes from "is `bun dev` running?" to "`goblin service start`". Like `backup`, `service` is not a client of the API: it shells to `launchctl` through the CLI's existing deps seam so tests run plist generation and `status` against a fake `launchctl`, never the real one. macOS only (exit `2` elsewhere). No CONTEXT.md term (operational, not domain) and no ADR (a plist is reversible in a minute); ADR-0001 already carries the one-sentence note (written with this ticket). Logs are not rotated: the server prints one line at boot and nothing per request. The nightly backup agent ADR-0001 promised is its own ticket: `docs/tickets/later/nightly-backup-agent.md`. Litestream and leaving the laptop stay out of scope (ADR-0001).

**Blocked by:** 09 (`goblin` CLI)

**Status:** done (implemented 2026-09-17 on branch `13-goblin-service`; verified against the real launchd on this laptop, except the logout/login pass, which `RunAtLoad` covers and only a logout can show)

- [x] `goblin service install` builds `web/dist`, writes the plist, loads it; the GUI answers on http://127.0.0.1:4747 from a shell in another repository with no `bun dev` running; it comes back after `kill -9` of the process and after a logout/login; running `install` twice is harmless
- [x] `start | stop | restart | status | logs | uninstall` each do one thing; `status` prints `{loaded, listening, checkout, db, pid}` as JSON (`loaded: false` with exit `0` when not installed); `logs` tails the two files; `stop` holds until next login; `uninstall` unloads and removes the plist and nothing else
- [x] `restart` rebuilds the GUI before bouncing the process, and a change to `web/src` is visible after it; a failed build leaves the old process running and exits `1`
- [x] `server.ts` on a busy port prints one line naming `goblin service stop` and `GF_PORT`; the exit-`3` hint names `goblin service start`
- [x] Tests cover plist contents (bun symlink path, absolute checkout path, log paths under `~/.goblin-foundry/logs`), the `status` shape with a fake `launchctl`, the aborted restart on build failure, and the non-macOS refusal
- [x] README: the "Run" section leads with `goblin service install`; `bun dev` moves to a "Hacking on Goblin" subsection that says to `goblin service stop` or set `GF_PORT` first

**Built:** `cli/src/service.ts` (the noun and the `Host` seam), `cli/test/service.test.ts` (20 tests
against a fake laptop), the `service` noun in `cli/src/commands.ts`, `host` on `GoblinDeps`, the
busy-port line in `api/src/server.ts`, and the exit-`3` hint in `cli/src/run.ts`. Two things the
grill did not foresee, both in `docs/LESSONS.md`: `launchctl bootout` returns before the job is out
of the domain, so `bootout` waits for `list` to stop answering; and a failed `bun run build` puts
its reason on stdout behind bun's filter prefix, so the refusal names `bun run build` rather than
quoting an output that would be prose on a stderr that carries only problem+json. One guard was
added beyond the ticket: `install`, `start` and `restart` refuse when something already answers on
4747 and it is not the agent, because loading `KeepAlive` on top of a `bun dev` would leave launchd
restarting a server that can never bind.

**Reviewed (two axes, 2026-09-17).** Standards: `agent()` renamed `launchdJob()` — in this repository an
`agent` is an AI (CONTEXT.md *Actor*), and a LaunchAgent job must not take the domain's word; the two
polling loops became one `until`; the waits and the `--lines` default are named constants. Spec: `uninstall`
now removes the plist in a `finally`, so a `bootout` launchd refuses cannot leave an agent on disk to come
back at the next login (the failure is still reported, exit `1`). Recorded rather than changed: five things
the checklist did not ask for — `requireFreePort` on `install`/`start`/`restart`, `--lines` on `logs`, the
two `install` preflights (no bun at the pinned path, no `server.ts` in the checkout), `waitForPort`'s wait
for the port after a bootstrap (~200 ms in practice, 5 s ceiling), and every mutating verb answering with
the `status` shape so the noun has one output. `stop` deliberately does not require an installed plist,
unlike `start`: it names a state, and on a laptop with no agent that state already holds. One contradiction
in this ticket, settled toward the checklist: "What to build" and the checklist say build then write the
plist, the decisions paragraph says "rewrite plist, build, reload" — the code builds first, so a failed
build leaves the installed agent exactly as it was.
