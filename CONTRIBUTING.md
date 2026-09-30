# Contributing to Goblin Foundry

Thanks for taking an interest. Goblin is a personal, local-first tracker with an explicit domain model and a deliberately restrained interface.

## Propose a change

Open a GitHub issue for a bug or feature proposal. For bugs, include your OS, Bun version, steps to reproduce, and what you expected to happen. Use synthetic examples instead of attaching your personal database.

For larger changes, discuss the approach before building it. Maintainer planning lives in Goblin itself; contributors do not need access to the maintainer's tracker. Historical tickets under `docs/tickets/` explain earlier work.

## Work locally

Follow the [development guide](docs/development.md). Use `GF_DB_PATH` for a separate database. Read [CONTEXT.md](CONTEXT.md) for domain terms and [architecture decisions](docs/adr) for the reasons behind the boundaries.

Before opening a pull request, run:

```sh
bun test
bun run typecheck
bun run lint
bun run build
```

For interface or browser behavior changes, also run `bun run test:e2e` after installing the Playwright browsers. Include screenshots for visual changes and follow [the design system](design/DESIGN.md).

Keep pull requests focused. Explain the problem, the resulting behavior, and how you verified it. Add meaningful tests for changed behavior. Avoid unrelated formatting or generated files.

## Working with agents

Agents must use `--actor agent` when changing Goblin records. They can prepare work in planning; lifecycle approval belongs to a human. See [the tracker instructions](docs/agents/issue-tracker.md).
