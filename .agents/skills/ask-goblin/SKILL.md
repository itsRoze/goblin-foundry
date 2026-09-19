---
name: ask-goblin
description: Ask whether a situation is a screen question for impeccable or an engineering question for /ask-matt.
disable-model-invocation: true
---

# Ask Goblin

One question: is this about how a screen looks, reads or behaves, or about building the thing? Screens go to an impeccable command, named below. Everything else is engineering and goes to `/ask-matt`, the map of Matt's skills; this file does not route them.

## Screens: which impeccable command

| The situation | Reach for |
|---|---|
| A screen is built and something feels off | `/impeccable critique <screen>`, then `/impeccable polish`, or the one refine command critique names |
| What should this screen look like, before it exists | `/impeccable shape`: a short interview that ends in a brief and writes no code. The brief goes into the ticket, or into the spec when the grilling comes first |
| Labels, hints or refusal sentences read wrong | `/impeccable clarify` (voice per DESIGN.md Voice) |
| Type or spacing is off | `/impeccable typeset` · `/impeccable layout` |
| Too much on the screen | `/impeccable distill` · `/impeccable quieter` |
| It breaks at some width | `/impeccable adapt` (`e2e/z-responsive.e2e.ts` holds the tiers) |
| Missing loading, empty or error states; long text overflows | `/impeccable harden` |
| The board feels slow | `/impeccable optimize` |
| Time for a sweep: monthly-ish, or before a release | `/impeccable audit web/src`, a scored pass that routes each finding to the command that fixes it, then `/impeccable harden` on what it names |
| Impeccable says its own files have drifted | `/impeccable doctor` |

A `<screen>` is its source file (`web/src/pages/Board.tsx`), with the URL it renders at when one is running: impeccable anchors on the file and looks at the URL.

## The one step nobody invokes

At the end of `/implement`, when the diff touches `web/src`, `design/DESIGN.md` or `design/tokens.css`, the `ui-closeout` skill runs critique and polish on the screens the ticket touched, before the commit. `/ui-closeout` runs it by hand on a branch.

## Everything else: `/ask-matt`

An idea to sharpen, something broken, a branch to review, codebase upkeep, words that need defining, a screen question that needs running code rather than a brief: engineering. `/ask-matt` says which of Matt's skills.

## The brief wins

Impeccable carries category defaults of its own: shadows with an offset and a blur, a 16px body floor, drawn icons, one authored motion moment. DESIGN.md is this house's brief, and impeccable honours a brief over its defaults; `.impeccable/critique/ignore.md` lists the standing exceptions with the DESIGN.md section that decided each. When a command wants to change one of those the command is wrong, not the house style; when the house style is wrong, change DESIGN.md first and let the command follow.

## Not for this house

`bolder`, `overdrive`, `delight` and `colorize` push the other way from DESIGN.md Overview. `animate` has nothing to add to Motion. `onboard` has no first-run to design in S1. `live` wants a dev server with HMR or a static page, and `bun dev` is a watch build behind the API. `extract` has nothing to pull: the system is already `design/tokens.css` plus DESIGN.md. `craft` is a deprecated alias.

## What impeccable reads

`PRODUCT.md` (written through `/impeccable init`) and `DESIGN.md` (a symlink to `design/DESIGN.md`, kept in impeccable's DESIGN.md format: token frontmatter, then the sections) at the root. `/impeccable document` regenerates the tokens and sections from the CSS; choose *merge* when it asks, so the house prose survives, and check afterwards that the root `DESIGN.md` is still a symlink and not a new file beside a stale `design/DESIGN.md`. A token change is `design/tokens.css` first, then the frontmatter. `.impeccable/config.json` names `web` as the one app in this workspace and keeps `design/rough-*` and `research/` out of the detector. A command with no file or route to anchor on asks which app: do not answer it, name a file (`web/src/pages/Board.tsx`) and rerun, because answering moves impeccable's working directory to `web/` and its snapshots and ignore.md move with it. Its boot also prints `MANUAL_DETECTOR_REQUIRED`: it cannot see a plugin-installed hook, but the hook is running, and one detector run over the changed files at the end satisfies it. Never answer that with `/impeccable hooks on`, which writes a `.Codex/settings.local.json` hook pointing at `.Codex/skills/impeccable/…`, a path this repo does not have.

The design hook runs the detector after edits to UI files and speaks only when it finds something, design-system drift included (`detector.advisoryRules` is `include`, without which the hook keeps that to itself; `/impeccable doctor` calls that key unknown because its list lags the hook, so leave it); `/impeccable hooks off` silences it for this project.
