# Goblin Foundry
set dotenv-load := true

# List targets.
default:
    @just --list

# Start Claude Code in Opus with Clear, Concise, Actionable Communication appended.
sr-opus:
    claude --dangerously-skip-permissions --model "opus" --append-system-prompt-file "{{justfile_directory()}}/sr_system_prompt.md"

# Install workspace dependencies.
install:
    pnpm install

# Bring Postgres up (wal_level=logical) and wait for it.
up:
    pnpm db:up
    @until docker compose -f infra/docker-compose.yml exec -T postgres pg_isready -U goblin -d factory >/dev/null 2>&1; do sleep 1; done
    @echo "postgres ready on 6432"

# Stop Postgres (keeps the volume).
down:
    pnpm db:down

# Stop Postgres and delete all data.
nuke:
    pnpm db:nuke

# psql into the factory database.
psql:
    pnpm db:psql

# Apply pending SQL migrations.
migrate:
    pnpm --filter @goblin/schema migrate

# Seed the factory project, its statuses, and starter tickets (idempotent).
seed:
    pnpm --filter @goblin/schema seed

# One-shot import from smriti's factory.db. Use --dry-run first.
import-smriti *ARGS:
    pnpm --filter @goblin/schema import-smriti {{ARGS}}

# Run zero-cache (sync engine) against the goblin_zero publication.
# Binds :4849 for clients and :4850 for its own change-streamer.
zero:
    #!/usr/bin/env bash
    set -euo pipefail
    if lsof -ti :4849 >/dev/null 2>&1 || lsof -ti :4850 >/dev/null 2>&1; then
      echo "zero-cache is already running (:4849/:4850). Use it, or 'just stop' first." >&2
      exit 1
    fi
    exec ./packages/schema/node_modules/.bin/zero-cache

# Fresh database: nuke, up, migrate, seed.
reset: nuke up migrate seed

# Link the factory's skills into this repo's .claude/skills so /plan works here.
install-skills:
    @mkdir -p .claude/skills
    @for s in packages/skills/*/; do \
        name=$(basename "$s"); \
        rm -rf ".claude/skills/$name"; \
        ln -s "../../$s" ".claude/skills/$name"; \
        echo "linked /$name"; \
    done

# Run the worker: claim tickets in a trigger status and take them through.
work:
    #!/usr/bin/env bash
    set -euo pipefail
    if pgrep -f "goblin-worker" >/dev/null 2>&1; then
      echo "a worker is already running (pgrep -f goblin-worker). Use 'just stop-work' first." >&2
      exit 1
    fi
    exec pnpm --filter @goblin/worker start

# Stop the worker, waiting for any run in flight to finish.
stop-work:
    #!/usr/bin/env bash
    set -euo pipefail
    pids=$(pgrep -f "goblin-worker" || true)
    if [ -z "$pids" ]; then echo "no worker running"; exit 0; fi
    live=$(pnpm --silent --filter @goblin/schema exec tsx -e "
      import {connect} from './src/sql.ts';
      const sql = connect();
      const rows = await sql\`select id, ticket_id from run where status in ('running','awaiting_input')\`;
      console.log(rows.map(r => r.id + ' on ' + r.ticket_id).join(', '));
      await sql.end();" 2>/dev/null || true)
    if [ -n "$live" ]; then
      echo "waiting for the run in flight: $live"
      echo "(ctrl-c and 'just kill-work' if you need it dead now — the run will be left stalled)"
    fi
    kill $pids
    while pgrep -f "goblin-worker" >/dev/null 2>&1; do sleep 2; done
    echo "worker stopped"

# Kill the worker now, run in flight or not. The run is left for the reaper.
kill-work:
    @pkill -9 -f "goblin-worker" 2>/dev/null && echo "worker killed" || echo "no worker running"

# Stop the worker (waiting for its run) and start a fresh one.
restart-work: stop-work work

# Claim and build exactly one ticket, then exit.
work-once:
    pnpm --filter @goblin/worker once

# The API (SSE feed, designs, approvals).
api:
    #!/usr/bin/env bash
    set -euo pipefail
    if lsof -ti :4848 >/dev/null 2>&1; then
      echo "the api is already running on :4848. Use it, or 'just stop' first." >&2
      exit 1
    fi
    exec pnpm --filter @goblin/api dev

# The web UI.
web:
    pnpm --filter @goblin/web dev

# What is up, and on which port.
ps:
    #!/usr/bin/env bash
    for svc in "postgres 6432" "api 4848" "zero-cache 4849" "web 5173"; do
      set -- $svc
      if lsof -ti :$2 >/dev/null 2>&1; then echo "  up    $1 ($2)"; else echo "  down  $1 ($2)"; fi
    done
    if pgrep -f "goblin-worker" >/dev/null 2>&1; then echo "  up    worker"; else echo "  down  worker"; fi

# Stop the dev processes (leaves Postgres running; use 'just down' for that).
stop:
    #!/usr/bin/env bash
    for port in 4848 4849 4850 5173; do lsof -ti :$port | xargs -r kill 2>/dev/null || true; done
    pkill -f "goblin-worker" 2>/dev/null || true
    echo "stopped api, zero-cache, web and worker"
