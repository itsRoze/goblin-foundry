# Goblin Foundry

Domain language in `GLOSSARY.md`; decisions in `docs/adr/`; the S1 spec in `docs/specs/S1-tracker-core.md`; the S1 plan of record one file each under `docs/tickets/s1/` (history — new work lives in Goblin, see below); house style in `design/DESIGN.md` (the root `DESIGN.md` is a symlink to it) with tokens in `design/tokens.css`; lessons in `docs/LESSONS.md`. `bun run lint` holds the mechanical half of the house style.

## Agent skills

Two skill sets: Matt Pocock's engineering flow and impeccable's design commands. `/ask-goblin` says which set a situation belongs to and which impeccable command; `/ask-matt` maps Matt's. Agents read the first at `.claude/skills/ask-goblin/SKILL.md`.

At the end of `/implement`, when the diff touches `web/src`, `design/DESIGN.md` or `design/tokens.css`, run the `ui-closeout` skill after the tests pass and before Matt's code review (`mattpocock-skills:code-review`, not the built-in `/code-review`) and the commit.

### Issue tracker

Goblin itself, at `http://127.0.0.1:4747`, driven by the `goblin` CLI (on `PATH`, so it works from any directory). This repo is the `goblin-foundry` app. An agent acts with `--actor agent`, which records whose hands made a change and permits nothing: either Actor makes every transition (ADR-0012). It moves tickets as the workflow it is running says, parks them in `planning` when the human wants to sign off first, and links each PR to its ticket before submitting that ticket to `review`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage state is the ticket's status where a status can carry it: `needs-triage`, `ready-for-agent` and `wontfix`. The other two canonical roles, `needs-info` and `ready-for-human`, are Labels (ADR-0013). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.
