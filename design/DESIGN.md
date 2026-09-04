---
# Machine-readable copy of design/tokens.css, plus the Typography section's
# document-heading steps (19/16.5/14.5, set in web/src/app.css) and the
# component tokens impeccable's schema can hold (background, text, type,
# radius, padding, size). tokens.css is the source of truth: change a value
# there first, then here. Borders, the focus inset and motion live in
# .impeccable/design.json, which the schema here cannot carry. The prose below
# is the house style itself.
name: Goblin Foundry
description: Everforest dark, flat and matte, laid out like a tiling window manager. Colour carries meaning; almost nothing is decorative.
colors:
  page: "#232A2E"
  tile: "#2D353B"
  raised: "#343F44"
  rule: "#3D484D"
  rule-2: "#475258"
  ink: "#D3C6AA"
  mute: "#9DA9A0"
  dim: "#7A8478"
  system: "#A7C080"
  human: "#E67E80"
  live: "#E69875"
  draft: "#DBBC7F"
  review: "#83C092"
  link: "#7FBBB3"
typography:
  scale:
    "10.5": "10.5px"
    "11": "11px"
    "11.5": "11.5px"
    "13.5": "13.5px"
    "14": "14px"
    "14.5": "14.5px"
    "15": "15px"
    "16.5": "16.5px"
    "19": "19px"
    "20": "20px"
    "22": "22px"
  title:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, sans-serif"
    fontSize: "20px"
    fontWeight: 500
    lineHeight: 1.2
  heading:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.25
  body:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.14em"
  kbd:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "10.5px"
    fontWeight: 400
    lineHeight: "15px"
    letterSpacing: "0.05em"
  number:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.2
  stat:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "22px"
    fontWeight: 500
    lineHeight: 1.1
  doc-h1:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.25
  doc-h2:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, sans-serif"
    fontSize: "16.5px"
    fontWeight: 600
    lineHeight: 1.25
  doc-h3:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, sans-serif"
    fontSize: "14.5px"
    fontWeight: 600
    lineHeight: 1.25
  doc-h4:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, sans-serif"
    fontSize: "13.5px"
    fontWeight: 600
    lineHeight: 1.25
  doc-h5:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, sans-serif"
    fontSize: "13.5px"
    fontWeight: 500
    lineHeight: 1.25
  doc-h6:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, sans-serif"
    fontSize: "11.5px"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "0.14em"
rounded:
  none: "0"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "14px"
  s5: "18px"
  s6: "24px"
  gap: "12px"
  pad-y: "14px"
  pad-x: "18px"
components:
  bar:
    backgroundColor: "{colors.tile}"
    textColor: "{colors.mute}"
    typography: "{typography.label}"
    height: "32px"
    padding: "0 14px"
  tile:
    backgroundColor: "{colors.tile}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
  tile-head:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.system}"
    typography: "{typography.label}"
    padding: "8px 18px"
  tile-body:
    backgroundColor: "{colors.tile}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "14px 18px"
  row:
    textColor: "{colors.ink}"
    typography: "{typography.heading}"
    padding: "8px 8px"
  row-selected:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    typography: "{typography.heading}"
    padding: "8px 8px"
  card:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    typography: "{typography.heading}"
    rounded: "{rounded.none}"
    padding: "8px 12px"
  chip:
    textColor: "{colors.mute}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "2px 6px"
  button:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    typography: "{typography.meta}"
    rounded: "{rounded.none}"
    padding: "4px 10px"
  button-primary:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.system}"
    typography: "{typography.meta}"
    rounded: "{rounded.none}"
    padding: "4px 10px"
  button-danger:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.human}"
    typography: "{typography.meta}"
    rounded: "{rounded.none}"
    padding: "4px 10px"
  input:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "4px 8px"
  kbd:
    textColor: "{colors.mute}"
    typography: "{typography.kbd}"
    rounded: "{rounded.none}"
    padding: "0 5px"
  mode-line:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.mute}"
    typography: "{typography.label}"
    height: "26px"
    padding: "4px 8px"
  refusal:
    textColor: "{colors.mute}"
    typography: "{typography.meta}"
---

# Goblin Foundry — house style v0

**Status:** working notes, not a strict design system. This describes what the mockups do and why, so new screens look like they belong. When the product needs something these notes don't cover, do the sensible thing and update the notes afterwards. Drift is allowed; unexplained drift is not.

Tokens live in `design/tokens.css`; the YAML block above the title is their machine-readable copy for impeccable's detector, so a token changes there first and here second. `bun run lint` enforces the mechanical half of these notes: colour only via `var(--gf-*)`, `--gf-radius` only, no gradients/shadows/blur, opacity never a state mark (`.gf-btn:disabled` is the one documented exception), and no rule left behind once its component is gone. Rough mockups that produced this: `design/rough-v5/` (Everforest, flat), history in `rough-v0…v4`.

**Which mockups apply to S1:** `Kanban`, `Ticket`, `Project`, `Components`, `Tokens`. `Main` (Home with attention rows, claim order, live run meter) is an S5/S6 artefact — it assumes `needs_human`, leases and runs, none of which exist in S1 (ADR-0006).

**Shape of this file (since 2026-09-03):** impeccable's DESIGN.md format — the YAML block, then Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components and Do's and Don'ts in that order, followed by four house sections the format preserves as they are: Motion, Interaction, Voice, Deliberately not specified. Until then these notes were ten numbered sections, and anything that still cites a `§n` (a PR body, an older commit message) reads through this map:

| was | is now |
|---|---|
| §1 Stance | Overview |
| §2 Surfaces | Colors (the surface steps), Elevation & Depth (the focus effect, the ban on shadows), Shapes (the radius) |
| §3 Colour by meaning | Colors |
| §4 Type | Typography |
| §5 Layout | Layout |
| §6 Components | Components |
| §7 Motion | Motion |
| §8 Interaction | Interaction |
| §9 Voice | Voice |
| §10 Deliberately not specified | Deliberately not specified |

## Overview

**Creative North Star: "The Tiling Window Manager"**

A tracker that is a **control surface and a memory**, not a Linear clone. The visual model is a **tiling window manager**: a status bar with workspaces, tiles with gaps, one focused tile, keyboard hints in every title bar. Flat, matte, square. Colour carries meaning; almost nothing is decorative.

Three references, distilled: Linear's keyboard-first discipline and single-accent restraint; Everforest's warm, low-glare palette; a HUD's honesty about telemetry (numbers you read, not numbers you admire).

Everything on screen is a line in the bar or a tile on the desk. A tile's title bar names it in system-green mono caps and says what its keys do; the tile's own border takes the system colour when it is the focused one; its body is rows, or cards on the kanban. The density is a working tool's: type runs from 10.5 to 22 pixels and only a project's outcome tiles are allowed a big number. The one confirmed rejection is the magazine. A ticket design is not one, so there is no display type, no hero number and no editorial whitespace anywhere in the GUI.

**Key Characteristics:**

- Everforest dark, matte and opaque: three surface steps and 1px rules do all the work of depth.
- Square everywhere; the focused tile's border and inset is the only effect.
- One accent, one meaning; red is your attention and nothing else.
- IBM Plex Sans for words, JetBrains Mono for anything that is data.
- Keyboard first: every tile header shows its keys, and a drag always has a key that does the same thing.
- A refusal is one plain sentence, inline, that clears itself.

## Colors

Everforest dark with the small text lifted for contrast: five opaque greys for surfaces, three for text, and six accents that each mean exactly one thing.

### Primary

- **system** (green, `#A7C080`): the controller: ready, ok, focused, claim order. The focused tile's border, the active workspace, the legal drop column, a primary button, the active mode-line control.

### Accents by meaning

Each accent has one job. If a new state needs colour, first ask whether an existing meaning covers it.

- **human** (red, `#E67E80`): your attention is required. Nothing else is red.
- **live** (orange, `#E69875`): a run is alive right now — watch, don't touch. Carries the breathe animation.
- **draft** (yellow, `#DBBC7F`): not yet real: draft, no design, proposed.
- **review** (aqua, `#83C092`): in review, PR open, merge pending.
- **link** (blue, `#7FBBB3`): links, file paths, shas.

**Statuses → colour** (names per ADR-0003). `backlog` · `todo` · `planning` → draft (all three are "not yet real"; the column header, not the colour, tells them apart) · `ready` → system · `building` → system while built by hand (S1); switches to live only when a run row exists for the ticket (S5) — orange means "something is alive and costing money", never just "in progress" · `needs_human` (S5) → human · `review` → review · `done` → mute (the kanban's done column is deliberately quiet) · `cancelled` → mute, struck through, hidden by default. **Blocked is not a state** — it's a derived condition (an incomplete dependency) and is never a colour: outline glyph + strikethrough only.

### Neutral

Three opaque steps and one rule colour. No gradients, shadows, blur, glow, or radius.

- **page** (`#232A2E`): app background.
- **tile** (`#2D353B`): tiles, panels, table bodies.
- **raised** (`#343F44`): tile headers, cards, selected rows, chips.
- **rule** (`#3D484D`): 1px rules and tile borders.
- **rule-2** (`#475258`): inputs, kbd borders.
- **ink** (`#D3C6AA`): primary text.
- **mute** (`#9DA9A0`): secondary text, labels, hints.
- **dim** (`#7A8478`): handles and dividers only.

Text: `--gf-ink #D3C6AA` primary, `--gf-mute #9DA9A0` secondary. `--gf-dim #7A8478` is for handles and dividers only — it fails contrast for words, deliberately.

**Contrast:** stock Everforest fails WCAG AA at label sizes. The mute and accent values above are chosen so every text colour clears 4.5:1 on `--gf-tile`. Do not reach back for the stock values for small text.

### Named Rules

**The one job rule.** Each accent has one meaning. A new state first asks whether an existing meaning covers it, and `--gf-human` is your attention and nothing else — removing a dependency brightens to ink rather than inventing a destructive red.

**The blocked-is-not-a-colour rule.** Blocked is a derived condition: an outline glyph and a struck title, never a hue and never opacity.

**The text-safe rule.** Every colour that carries words clears 4.5:1 on `--gf-tile`. `--gf-dim` carries no words.

## Typography

**Display Font:** none. There is no display role: the page title (Sans 500 20) tops the text ladder, and the only larger type is the stat number (Mono 500 22) on a project's outcome tiles.
**Body Font:** IBM Plex Sans (with `system-ui, -apple-system, sans-serif`)
**Label/Mono Font:** JetBrains Mono (with `ui-monospace, 'SF Mono', Menlo, monospace`)

**Character:** IBM Plex Sans for words, JetBrains Mono for identifiers and telemetry. Mono is a signal ("this is data, this is a key, this is a path"), not a mood — if a whole paragraph is mono, something is wrong.

### Hierarchy

| role | spec |
|---|---|
| page title | Sans 500 20/1.2 |
| row / card title | Sans 500 14/1.25 |
| body | Sans 400 13.5/1.5 |
| meta (under a title) | Mono 400 11.5 |
| label (tile header, kv key) | Mono 400 11, UPPERCASE, `--gf-track` (.14em) |
| kbd | Mono 400 10.5, 15px line, 1px `--gf-rule-2` border |
| telemetry number (in rows) | Mono 500 15 — text size. The rule is *telemetry inside rows is text-size*. |
| stat (project outcome tiles only) | Mono 500 22 — the one place a number is allowed to be big |
| document headings (editor) | Sans 19/16.5/14.5/13.5 at 600 for h1–h4, then h5 Sans 500 13.5 mute, h6 Sans 500 11.5 mute, uppercase, tracked |

Six heading levels need six visible steps, and a ticket design is not a magazine: size carries h1–h4, and below that the differentiator becomes weight, then colour, then tracking. An h6 inside a design *is* a label, so it is set like one — which is also why the ladder stops widening rather than shrinking past body size.

**Run cost format** — `$x.xx / cap` everywhere: `$1.42 / 5.00`, `06:12 / 14:00`, `38 / 80`. Spent first, cap second, mute.

### Named Rules

**The mono-is-a-signal rule.** Mono says "this is data, a key, a path". A whole paragraph in mono is a bug, not a mood.

**The text-size telemetry rule.** A number inside a row is text size (Mono 500 15). Only a project outcome tile gets Mono 500 22.

## Layout

- The **bar** (32px): workspaces left, breadcrumb centre (`app / project`), counts right. Active workspace: `--gf-system` border. **S1 workspaces:** `1 board · 2 project · 3 app` — the kanban *is* home; there is no separate Home/attention screen until runs exist. `runs` and `evidence` workspaces and the live-run mini meter arrive with the controller (S5/S6). No `design rN @sha` in the breadcrumb: designs are edited in place in S1 (ADR-0005).
- The **desk**: a CSS grid of tiles with `--gf-gap` between them. Laptop (1440): 2 columns. Wide: 3 at 1920, 4 at 2560 — more tiles open (ticket detail, planning) rather than the same tiles getting bigger. Both steps are drift from the original single 2560 step, which said 3 columns: two columns already stretch a tile past 900px well before 2560, and at 2560 three columns are ~840px each — still past the ~650px a tile reads well at — so the tier that arrives at 2560 is the fourth, not the third. The number to hold is the *tile width*, not the column count. `e2e/z-responsive.e2e.ts` holds the tiers and the no-sideways-scroll rule.
- A **tile**: header (label + subtitle + key hints, on `--gf-raised`) and body (`--gf-pad-y` / `--gf-pad-x`). One tile is focused.
- Inside tiles, content is **rows** (grid columns, 1px rule between) or **cards** (kanban only).
- **Small layouts** (mobile-first): below laptop width the desk is a single column and tiles stack in workspace order; the kanban scrolls horizontally *inside* its tile, never the page; drag works on touch (long-press to lift); the bar collapses to workspace numbers + counts (below 900px; the crumb goes at 600px, but `trash` and `settings` never do — they are the only way to reach those pages). The tile grid appears at ≥1440.

Spacing is a 4px base: `--gf-s1` 4 · `--gf-s2` 8 · `--gf-s3` 12 · `--gf-s4` 14 · `--gf-s5` 18 · `--gf-s6` 24. `--gf-gap` (12px) is the WM gap between tiles, and a tile body's children sit `--gf-s3` apart, the same 12px under its own name; `--gf-pad-y` (14px) and `--gf-pad-x` (18px) pad a tile body; a tile header is `--gf-s2` tall-padded on the same horizontal padding, so header and body text align.

### Named Rules

**The tile width rule.** The number to hold is the tile width, not the column count: a wider desk opens more tiles rather than stretching the same ones, and the kanban, the one tile that spans the desk, caps its columns at 280px for the same reason.

## Elevation & Depth

Flat. There are no shadows, gradients, blur or glow anywhere; depth is three opaque steps — `--gf-page` under `--gf-tile` under `--gf-raised` — and a 1px `--gf-rule`. A tile header is raised above its body, a card is raised above its column, a selected row is raised above its neighbours, and that is the whole vocabulary. Interaction states move a border colour or step a surface up one level, never off the page: hover on a card lifts its border to `--gf-rule-2`, hover on a button to `--gf-mute`; a hovered row, a legal drop column and the picker's highlighted candidate go `--gf-raised`.

Focus = the tile border switches to `--gf-system`, plus a 1px inset of the same. That is the only "effect" in the system.

### Named Rules

**The one effect rule.** Depth is three opaque steps and a 1px rule. The focused tile's `--gf-system` border and 1px inset is the only effect in the system; `bun run lint` refuses any `box-shadow` that is not an inset.

## Shapes

`--gf-radius: 0` is a stance, with one known exception: browser-native focus outlines and `<kbd>` on macOS will round themselves. Let them; don't fight it with `outline: none`.

Everything is a rectangle drawn with a 1px rule: tiles, cards, chips, buttons, inputs, kbd. A chip is bordered, never filled. Selection is a 2px `--gf-system` inset on the left edge of a row. Marks are glyphs, not icons: ◆ ready, ● building, ◇ blocked, ▪ not yet real, ≡ a handle, × remove, and a diamond is a node in the dependency graph.

### Named Rules

**The square rule.** `--gf-radius` is `0` and nothing else is allowed on `border-radius`. Browser-native rounding on focus outlines and `<kbd>` is let be.

## Components

### As drawn in the mockups

The component sheet on the canvas uses wider gaps than the pages (a reference sheet, not a layout); pages use `--gf-gap` (12px).

- **Attention row** — `[n] KIND  id  Title / meta  ⟨key⟩`. Kind in mono caps; `--gf-human` when the kind is re-arm or answer. Selected row: `--gf-raised` + 2px `--gf-system` left inset.
- **Frontier row** — `≡ id  Title  STATE·note`. State marks: ◆ ready (`system`), ● building (`live`; breathes only when a run is alive, S5), ◇ blocked (outline `mute`), ▪ backlog/todo/planning (`draft`). Blocked titles go `mute` and strike through; never dim with opacity.
- **Refusal message** — mono, `--gf-mute`, one sentence, inline where the drop was refused, fading in over 120ms, no modal; it clears on the next drag or click, or after 4s. Two kinds. A **structural** refusal (no such arrow) is generated from the status pair: *a ticket in review does not go back to building*. An **owner** refusal (the arrow exists but isn't yours — S5) reads the table entry's owner and hint: *the controller moves this when the PR merges* · *re-arm needs you: press R*. A guard refusal names what is missing: *approve needs a ticket design*.
- **Kanban column width** — columns stop growing at 280px. A board spans the desk (`is-span`) because eight statuses need the room, so it is the one tile the column tiers do not narrow; without a cap an ultrawide simply makes every card 400px wide, which is the same failure the tiers exist to prevent.
- **Kanban card** — id + note (right, coloured by meaning), title, meta; a running card has a 3px meter. Column headers are the lifecycle; the controller's moves are stated, not implied. The whole card is the drag target — no grip. While a drag is live, columns the card has an arrow to take a 1px `--gf-system` border and `--gf-raised` fill; the rest go `--gf-mute` in the header. Never opacity.
- **Dependency tile** — one section per direction (`blocked by`, `blocks`), peers rather than a kv table, because an edge is one fact with two ends and either end may declare it. Edges that are no longer in the way keep their place, struck; a *trashed* end is not struck but labelled `in the trash`, because it is suspended rather than settled and re-blocks on restore (ADR-0009). Removal hangs off the blocked end (ADR-0004), so an edge whose *blocked* end is trashed cannot be undone from here: that row loses its `×` and its note says `— restore to edit` rather than leaving the absence unexplained.
- **Dependency graph** — diamond nodes, orthogonal edges, **dashed while the blocker is open**, solid once satisfied (this reverses the rough-v5 mockup, which dashed the dead edge and painted `done` green; Colors wins). The running node is `live` and breathes (opacity, `--gf-breathe`) — S5, when a run row exists. Legend is copy, not a key. *As built (issue 08):* a node is a filled diamond in its status colour, `done` filled mute; a **blocked** node is the same colour *hollow* with its title struck — the kanban's ◇, never a colour; a ticket outside the project is mute with no status treatment, one hop only. `cancelled` and Trashed tickets are not drawn, nor are their edges. Edges are steps that turn at the mid-gap, `--gf-mute` dashed while the blocker is open, `--gf-dim` solid once satisfied; no arrowheads (rank order carries direction), no opacity. Key in mono beside the diamond and just above the height the edges leave and arrive on, title beneath, clipped — a wire through a key reads as a strike, which in this house means something else (Colors). The popover (120ms hover, instant on focus, `--gf-raised` + 1px `--gf-rule`, in the scrolling content beside its node) carries key, title, status chip, blocked-by, the description's first line, and `app / project` for an external. The SVG is its natural size and scrolls inside the tile body, never the page; the tile does not span. The legend is a mute mono line under the graph, the subtitle counts what is drawn.
- **Ticket picker** — how you name another ticket (the dependency tile's `+ add`). A labelled hairline (mono caps label · the control · 1px `--gf-rule` running out to the edge — the control sits beside its label, never across a wide tile from it), then an open input bordered `--gf-system`, then candidates in the ordinary **row** shape — key, title, status chip — so what you choose from looks like what you get. The highlighted candidate takes the Attention row's selected treatment (`--gf-raised` + 2px `--gf-system` left inset); `↑↓` moves it, `⏎` declares. Candidates that are `done`/`cancelled` sort last and go `--gf-mute`: still legal to declare, rarely what you meant. The refusal lands under the picker, never at the foot of the tile.
- **Meter** — three columns: lowercase mono label (52px) · 4px track on `--gf-rule` with fill by meaning · mono 500 15 value right-aligned (`$1.42 / 5.00`).
- **Chip** — 1px border, mono 11, coloured by meaning when it carries state.
- **kv row** — 100px mono label column, value column. Used for ticket state.
- **Design revision row** — *parked until S6.* S1 has no revisions or shas (ADR-0005); a design's history is the ticket/project history tile. When proposals return: `rN` in mono (`--gf-human` when proposed), summary, status right.
- **Planning message** — 72px speaker column (`you` in `system`), text.

### As built in code (S1)

What `web/src/app.css` actually does, for the primitives the mockups take for granted.

- **Bar** — 32px on `--gf-tile` with a 1px `--gf-rule` beneath; mono label caps in `--gf-mute`. The active workspace, and the active `trash` or `settings` link, take a 1px `--gf-system` border and the system colour; hover brightens to ink. The crumb is meta type in `--gf-ink`, no caps, centred.
- **Tile** — `--gf-tile` body inside a 1px `--gf-rule` border. The header sits on `--gf-raised` with the label in `--gf-system` mono caps, the subtitle in `--gf-mute`, the keys right-aligned in `--gf-mute`; the body is padded `--gf-pad-y`/`--gf-pad-x` with `--gf-s3` between its children. `is-span` takes the whole desk; `is-focus` is the effect in Elevation & Depth.
- **Row** — a grid of title and meta stacked on the left and a trailing slot on the right, a 1px `--gf-rule` under each, bleeding `--gf-s2` into the tile padding so the hover fill and the rule sit wider than the words. A row that is a link hovers to `--gf-raised`. The picker's highlighted candidate is a row with the 2px `--gf-system` left inset.
- **Card** — `--gf-raised` in a 1px `--gf-rule` border, `--gf-s2` by `--gf-s3` padding, `cursor: grab` on the whole card. Hover lifts the border to `--gf-rule-2`; a lifted (dragging) card takes `--gf-system`. The status note beside the key wears the status colour; `cancelled` strikes title and note in `--gf-mute`; `blocked` strikes the title and puts ◇ before it, in `--gf-mute`.
- **Chip** — mono label caps at .08em tracking, 1px `--gf-rule-2` border, 2px by 6px, `--gf-mute` text. A chip carrying state colours its text and border by meaning; `is-struck` strikes it.
- **Button** — meta type in `--gf-ink` on `--gf-raised`, 1px `--gf-rule-2` border, 4px by 10px; hover brightens the border to `--gf-mute`. `is-primary` takes `--gf-system` for text and border; `is-danger` takes `--gf-human` for the text only: the one place red marks a destructive control rather than your attention, a standing tension with the one job rule that these notes record rather than resolve. Disabled is `opacity: .6`, the one place opacity is allowed, because a disabled control is a missing affordance and not a state mark. A button that has a key shows it as a kbd inside itself.
- **Input** — body type in `--gf-ink` on `--gf-page`, 1px `--gf-rule-2` border, 4px by 8px. An input that is the open thing on screen (a new ticket, the picker) is bordered `--gf-system` from the start. A form labels each field in a 100px mono caps column, the kv row's shape.
- **kbd** — Mono 10.5 on a 15px line in `--gf-mute`, 1px `--gf-rule-2` border, 0 by 5px, .05em tracking.
- **Editor** — the document is body type in `--gf-ink` with no focus box of its own, because the caret is the focus signal and focus belongs to the tile border. Inline code is meta mono in `--gf-link`; a fence sits on `--gf-page` in a 1px `--gf-rule` border; a blockquote carries a 2px `--gf-rule-2` left rule and goes `--gf-mute`; list markers are `--gf-dim`; task checkboxes take `--gf-system` as their accent. The headings are the six steps in Typography. The mode line is described in Interaction.
- **Refusal and confirm** — meta mono in `--gf-mute`, a paragraph with `role="alert"`; the board's column refusal fades in over `--gf-fast`, the others appear at once. The confirm is the same line with a `verb anyway` button and a `cancel` button inside it: the one question the tracker asks before doing what you said.

### Named Rules

**The inline refusal rule.** A refusal is one mono sentence in `--gf-mute`, placed where the action was refused, clearing on the next click or drag or after 4s. Never a modal, never a toast.

**The whole card rule.** The whole card is the drag target: no grip, no handle, no affordance drawn on it.

## Do's and Don'ts

### Do:

- **Do** take every colour from a token: `var(--gf-*)`, never a literal. `bun run lint` refuses hex in `web/src`.
- **Do** give a new state an existing meaning before you reach for a new colour, and say what the colour means in the status note or the column header, not only in the hue.
- **Do** set identifiers, keys, paths, timestamps and numbers in JetBrains Mono, and words in IBM Plex Sans.
- **Do** keep a number inside a row at text size (Mono 500 15); only a project outcome tile gets Mono 500 22.
- **Do** write the run cost as `$x.xx / cap`, spent first, cap second, in mute.
- **Do** show every tile's keys in its header, and give every drag a key that does the same thing.
- **Do** refuse with one plain sentence, inline, where the action was refused, and let it clear itself.
- **Do** show blocked as ◇ and a struck title, and cancelled as a struck title in mute.
- **Do** hold the tile width when the desk widens: open more tiles, cap the kanban's columns at 280px.
- **Do** let browser-native focus outlines and `<kbd>` round themselves.

### Don't:

- **Don't** use a `border-radius` other than `0`, a gradient, a shadow that is not the focus inset, a blur, or a glow.
- **Don't** use opacity as a state mark; `.gf-btn:disabled` is the one documented exception, because a disabled control is a missing affordance, not a state.
- **Don't** use `--gf-human` for anything but "your attention is required", and don't invent a destructive red.
- **Don't** use `--gf-live` for "in progress"; orange means a run is alive and costing money, and until a run row exists a hand-built `building` ticket is `--gf-system`.
- **Don't** set a whole paragraph in mono, or put `--gf-dim` on words.
- **Don't** raise a modal or a toast for a refusal, a confirm, or a save state.
- **Don't** add a grip, a handle or an icon to a card; the card is the drag target and marks are glyphs.
- **Don't** reach for stock Everforest values for small text; the palette here was lifted to clear 4.5:1 on `--gf-tile`.
- **Don't** add a marquee, scanline, pulse-glow or spring; the live node's breathe is the one ambient animation.
- **Don't** draw a pie chart, a hero number or display type; a ticket design is not a magazine.

## Motion

Hover/focus/selection: 120ms. Tiles and rows moving: 200ms. One ambient animation only — the live run's node breathing. Under `prefers-reduced-motion` transitions collapse to instant and the breathe is `animation: none` (not 0s, which flickers). No marquee, scanline, pulse-glow, or spring.

## Interaction

Keyboard first, Linear-style: `j/k` move, `⏎` open, `a` approve, `r` re-arm, `s` status, `c` create a ticket in the current scope, `v` view options, `d` deps, `p` plan, `esc` back, `⌘K` anything, `⌘1–6` focus a tile. Every tile header shows its keys. Drag exists for kanban (S1) and claim order (S5); keys always do the same thing. A kanban drag *is* a transition: the board offers only the columns the dragger owns an edge to, and a refused drop shows the transition table's `hint` inline.

Authority is visible: transitions the controller owns are never offered as drags; a refused move says who owns it.

**As built (S1, issues 02–03):** `e` edits inline — the `about` tile on an App or Project, the description on a Ticket, the prefix on `/settings`; `c` creates a Ticket in the scope on screen — the top of `backlog` on the board, prefilled on an App or Project view, nothing on the all-apps/all-projects lists; `v` opens the board's view options; `⌘⌫` trashes the Ticket you are looking at, with no confirm (the trash is the undo). In `/trash`, `r` restores (re-arm arrives with runs, S5, and will take `r` on the board — the trash keeps it, the two never share a screen). `⌘⏎` saves any inline form, `esc` cancels it. From issue 07 that holds for forms only: text fields on a view are always live and save themselves, so there `e` focuses the focused tile's editor (a jump, not a mode), `⌘⏎` flushes and blurs, `esc` blurs, and there is no cancel — the tile header carries a `saving…`/`saved` state where the save key used to be. `n` is retired: an App or Project form opens from a `+` in its tile header until `⌘K` (issue 10) makes creation reachable by name. The bar carries `trash` and `settings` links at the right, after the counts, for the same reason.

**Kanban card, as built:** the note beside the key is the status itself, coloured per Colors — S1 has no approval state, PR or run to say anything more honest. `app / project` (`—` for an orphan) and `updated` are view options; the key and the note never hide.

**As built (S1, issue 07):** every long text field on a view is the editor and the read view at once — a ticket's description, its `design` tile, a Project's `design` tile, and an App's or Project's description inside `about`. There is no edit mode, no save button and no cancel: typing saves itself after a beat, on blur, and on the way out of the view, and the tile header carries `saving…` then `saved` where the save key used to be. `e` jumps into the focused tile's editor (the first editor on the page when the focused tile has none — tile focus is static until `⌘1–6` lands in issue 10, so a second editor on the same view is a click away for now), `⌘⏎` flushes and lets go, `esc` lets go. Undo is `⌘Z` while you are in the field and the edit session in history once you have left it.

**The mode line (S1, issue 07):** a field with the caret in it grows a status bar along its bottom edge — the tiling-WM idiom of the Overview applied to writing, not a floating bubble or a ribbon. Mono, lowercase, groups divided by hairlines: `h1…h6` · `b i code s link` · `list 1. task quote fence`. An active control takes `--gf-system`, like a focused tile. A control's tooltip names its key (`⌘B`, `⌘I`, `⌘E`, `⌘⇧X`, `⌘K`), so clicking teaches the keyboard rather than replacing it; `task` names none, because the list extensions bind `⌘⇧7` and `⌘⇧8` and stop there. A field shows only the controls its own schema has, so the inline shape has no `s`. A link opens when it is clicked, because the field is the read view as well as the editor (ADR-0005) — the caret reaches one by arrowing in. `⌘K` types a URL; a URL already on the clipboard, pasted over a selection, links it without opening anything, which is the commoner way round. The right slot is the contextual one: the URL field on `⌘K`, the language of the fence you are standing in (markdown's ``` is not in the document, so this is the only place to read or change it), and otherwise `⌘⏎ done`. It is placed out of the layout, because a bar that appears between a mousedown and its mouseup moves whatever you were aiming at. A field that is what its tile is for — a `design` — takes the whole tile, so the line rests on the tile's bottom edge instead of crowding the last line written, and the whole tile is somewhere to click and start typing. A field with other content under it keeps its line directly beneath itself, where the field it belongs to is — pinning *those* to the tile's edge would put a description's status line below the archive and trash buttons, which is not where the description is. They get a hand's width of space under the last line instead, so the line is not against the text. An inline field shows the marks only. A mark toggles on whatever the caret is pointing at: with nothing selected, `code` inside a code span takes the span off, because the backticks are not in the document and the span is the only thing there is to point at. A selection means the selection.

**Markdown shows itself where the caret is:** the span the caret is on grows its markers — `` ` ``, `**`, `*`, `~~` — in `--gf-dim`, the handle colour, because that is what they are. A rendered span otherwise hides where it begins and ends, and markdown is what is actually stored (ADR-0005). They are decorations, not characters — the document is rich text and the markers exist only in the serialised form — but the caret behaves as though they were, which is the model `prosemirror-codemark` established for this problem. A run has four positions you can see and two the document knows about, so **at an edge the arrow steps the caret across the marker rather than moving it**: the mark turns on or off for whatever you type next, and the marker swaps to the other side of the caret to say which. That is also the only way out of a run that opens a line, where there is no position to its left to arrow into. **Backspace deletes a marker that is behind the caret** — takes the mark off the run — and a second press is an ordinary backspace again. Behind the caret means at a run's opening edge when you are inside it, or its closing edge when you are outside it; the other two positions have an ordinary character behind them instead, and backspace eats that. `⌘E` and the mode line still take a whole span off from anywhere in it. A fence is left out for now (`docs/tickets/later/fence-syntax-reveal.md`): its ``` is two whole lines rather than two characters, so showing them on entry would shift the page, and its language is already in the mode line. The `about` tile of an App or Project keeps an explicit `edit` form for the fields that are not prose — a name, a repository, an app — because those are choices, not writing. Designs render as prose: sans body, mono only for `code`, and the six heading steps of Typography.

**As built (S1, issue 04):** a card drags to any column it has an arrow to; the move is optimistic and rolls back with the refusal message on a `409`. Drop *position* means nothing — there is no claim order in S1, so there is no insertion line, only the column. `cancel` is a button, not a drag: the `cancelled` column is hidden unless you switch it on. The Ticket view's `state` tile carries the same arrows as buttons, derived from the same table, in reading order, with `cancel` and `trash` in a separated group below — `cancel` is an ordinary transition, `trash` is the destructive one. `approve` is offered even when its guard will refuse it: a button that explains itself teaches more than a button that isn't there. The `simple` toggle sits in the same tile, next to what it gates. History reads `approved · planning → ready` — the verb first, the arrow after.

## Voice

Short, plain, sentence case. Kinds and states are single words (`approve`, `re-arm`, `answer`, `needs you`, `building`). Meta lines say what happened, not what it means (`verify failed twice, same failure · $3.80 spent`). Hints are verbs with a key (`A approve`, `⏎ reply`). No exclamation marks. Numbers are honest: `$1.42 / 5.00`, never a pie chart.

## Deliberately not specified

Light mode (dropped for now). When it comes, accents get new values, names stay — `--gf-page/-tile/-raised` are theme-neutral names; the accent hexes and `--gf-dim`'s "fails contrast deliberately" are dark-mode facts. Icons (none yet — marks are glyphs and colour; add an icon set only when a glyph fails). Charts beyond meters. Illustration and characters (logo only, if ever). A TUI (explored, parked).
