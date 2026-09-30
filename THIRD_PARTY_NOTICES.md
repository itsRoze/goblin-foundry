# Third-party notices

The root MIT license covers Goblin Foundry's original code and documentation. It does not replace the licenses of bundled tools or installed dependencies.

## Bundled agent tools

- **Impeccable**, by Paul Bakaus and contributors: [upstream](https://github.com/pbakaus/impeccable), [Apache License 2.0](docs/licenses/impeccable-Apache-2.0.txt). Bundled under `.agents/skills/impeccable` and `.claude/skills/impeccable`, with agent configuration under `.claude/agents` and `.codex/agents`. Local configuration and skill instructions include Goblin-specific adaptations.
- **Matt Pocock's skills**, copyright 2026 Matt Pocock: [upstream](https://github.com/mattpocock/skills), [MIT license](docs/licenses/matt-pocock-MIT.txt). Engineering skills under `.agents/skills` and their `.claude/skills` links include locally adapted versions and Goblin-specific additions.

License texts were retrieved from the respective upstream repositories for the public release. Package dependencies, including the bundled web fonts, retain the licenses distributed with those packages in `node_modules`.
