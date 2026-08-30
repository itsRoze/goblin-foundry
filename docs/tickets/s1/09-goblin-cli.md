# 09: `goblin` CLI

**What to build:** A thin command-line client over the API, JSON in and out, one subcommand per endpoint: apps, projects, tickets (create, show, update, design set), dependencies (add, remove), transitions (`goblin ticket approve GF-12` etc.), frontier, events, settings. `--actor agent` sets the actor header; tickets created with actor `agent` land in `planning` regardless of input. `goblin backup <dir>` writes a dated `VACUUM INTO` copy of the database. The CLI is a client, never a second write path; it is tested by invoking its command handlers against the in-process app.

**Blocked by:** 05 (Dependencies and the ready frontier)

**Status:** ready-for-agent

- [ ] Every API endpoint reachable through `goblin`; `--json` output stable for scripting; non-zero exit and problem+json on error
- [ ] `--actor agent` recorded on events; agent-created tickets start in `planning`
- [ ] `goblin backup <dir>` produces a valid SQLite file that opens and contains the data
- [ ] Tests run the command handlers against the in-process seam: create app → project → ticket → design → dependency → approve → frontier shows it
- [ ] README section: install, `goblin --help`, example planning transcript
