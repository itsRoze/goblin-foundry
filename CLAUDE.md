# Goblin Foundry

Domain language in `CONTEXT.md`; decisions in `docs/adr/`; the S1 spec in `docs/specs/S1-tracker-core.md`; tickets one file each under `docs/tickets/s1/`, worked blockers-first; house style in `design/DESIGN.md` (the root `DESIGN.md` is a symlink to it) with tokens in `design/tokens.css`; lessons in `docs/LESSONS.md`. `bun run lint` holds the mechanical half of the house style.

## Agent skills

Two skill sets: Matt Pocock's engineering flow and impeccable's design commands. `/ask-goblin` says which set a situation belongs to and which impeccable command; `/ask-matt` maps Matt's. Agents read the first at `.claude/skills/ask-goblin/SKILL.md`.

At the end of `/implement`, when the diff touches `web/src`, `design/DESIGN.md` or `design/tokens.css`, run the `ui-closeout` skill after the tests pass and before Matt's code review (`mattpocock-skills:code-review`, not the built-in `/code-review`) and the commit.
