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

# Run the worker: claim tickets in ready_for_dev and build them.
work:
    pnpm --filter @goblin/worker start

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
    if pgrep -f "worker/src/index.ts" >/dev/null 2>&1; then echo "  up    worker"; else echo "  down  worker"; fi

# Stop the dev processes (leaves Postgres running; use 'just down' for that).
stop:
    #!/usr/bin/env bash
    for port in 4848 4849 4850 5173; do lsof -ti :$port | xargs -r kill 2>/dev/null || true; done
    pkill -f "worker/src/index.ts" 2>/dev/null || true
    echo "stopped api, zero-cache, web and worker"
