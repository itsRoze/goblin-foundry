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
