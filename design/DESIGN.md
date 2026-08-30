# Goblin Foundry — house style v0

**Status:** working notes, not a strict design system. This describes what the mockups do and why, so new screens look like they belong. When the product needs something these notes don't cover, do the sensible thing and update the notes afterwards. Drift is allowed; unexplained drift is not.

Tokens live in `design/tokens.css`, and `bun run lint` enforces the mechanical half of these notes: colour only via `var(--gf-*)`, `--gf-radius` only, no gradients/shadows/blur, opacity never a state mark (`.gf-btn:disabled` is the one documented exception), and no rule left behind once its component is gone. Rough mockups that produced this: `design/rough-v5/` (Everforest, flat), history in `rough-v0…v4`.

**Which mockups apply to S1:** `Kanban`, `Ticket`, `Project`, `Components`, `Tokens`. `Main` (Home with attention rows, claim order, live run meter) is an S5/S6 artefact — it assumes `needs_human`, leases and runs, none of which exist in S1 (ADR-0006).

## 1. Stance

A tracker that is a **control surface and a memory**, not a Linear clone. The visual model is a **tiling window manager**: a status bar with workspaces, tiles with gaps, one focused tile, keyboard hints in every title bar. Flat, matte, square. Colour carries meaning; almost nothing is decorative.

Three references, distilled: Linear's keyboard-first discipline and single-accent restraint; Everforest's warm, low-glare palette; a HUD's honesty about telemetry (numbers you read, not numbers you admire).

## 2. Surfaces

Three opaque steps and one rule colour. No gradients, shadows, blur, glow, or radius.

| token | hex | used for |
|---|---|---|
| `--gf-page` | `#232A2E` | app background |
| `--gf-tile` | `#2D353B` | tiles, panels, table bodies |
| `--gf-raised` | `#343F44` | tile headers, cards, selected rows, chips |
| `--gf-rule` | `#3D484D` | 1px rules and tile borders |
| `--gf-rule-2` | `#475258` | inputs, kbd borders |

`--gf-radius: 0` is a stance, with one known exception: browser-native focus outlines and `<kbd>` on macOS will round themselves. Let them; don't fight it with `outline: none`.

Focus = the tile border switches to `--gf-system`, plus a 1px inset of the same. That is the only "effect" in the system.

## 3. Colour by meaning

Each accent has one job. If a new state needs colour, first ask whether an existing meaning covers it.

| token | hex | meaning |
|---|---|---|
| `--gf-system` | `#A7C080` | the controller: ready, ok, focused, claim order |
| `--gf-human` | `#E67E80` | your attention is required. Nothing else is red. |
| `--gf-live` | `#E69875` | a run is alive right now — watch, don't touch. Carries the breathe animation. |
| `--gf-draft` | `#DBBC7F` | not yet real: draft, no design, proposed |
| `--gf-review` | `#83C092` | in review, PR open, merge pending |
| `--gf-link` | `#7FBBB3` | links, file paths, shas |

**Statuses → colour** (names per ADR-0003). `backlog` · `todo` · `planning` → draft (all three are "not yet real"; the column header, not the colour, tells them apart) · `ready` → system · `building` → system while built by hand (S1); switches to live only when a run row exists for the ticket (S5) — orange means "something is alive and costing money", never just "in progress" · `needs_human` (S5) → human · `review` → review · `done` → mute (the kanban's done column is deliberately quiet) · `cancelled` → mute, struck through, hidden by default. **Blocked is not a state** — it's a derived condition (an incomplete dependency) and is never a colour: outline glyph + strikethrough only.

Text: `--gf-ink #D3C6AA` primary, `--gf-mute #9DA9A0` secondary. `--gf-dim #7A8478` is for handles and dividers only — it fails contrast for words, deliberately.

**Contrast:** stock Everforest fails WCAG AA at label sizes. The mute and accent values above are chosen so every text colour clears 4.5:1 on `--gf-tile`. Do not reach back for the stock values for small text.

## 4. Type

IBM Plex Sans for words, JetBrains Mono for identifiers and telemetry. Mono is a signal ("this is data, this is a key, this is a path"), not a mood — if a whole paragraph is mono, something is wrong.

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

**Run cost format** — `$x.xx / cap` everywhere: `$1.42 / 5.00`, `06:12 / 14:00`, `38 / 80`. Spent first, cap second, mute.

## 5. Layout

- The **bar** (32px): workspaces left, breadcrumb centre (`app / project`), counts right. Active workspace: `--gf-system` border. **S1 workspaces:** `1 board · 2 project · 3 app` — the kanban *is* home; there is no separate Home/attention screen until runs exist. `runs` and `evidence` workspaces and the live-run mini meter arrive with the controller (S5/S6). No `design rN @sha` in the breadcrumb: designs are edited in place in S1 (ADR-0005).
- The **desk**: a CSS grid of tiles with `--gf-gap` between them. Laptop (1440): 2 columns. Wide: 3 at 1920, 4 at 2560 — more tiles open (ticket detail, planning) rather than the same tiles getting bigger. Both steps are drift from the original single 2560 step, which said 3 columns: two columns already stretch a tile past 900px well before 2560, and at 2560 three columns are ~840px each — still past the ~650px a tile reads well at — so the tier that arrives at 2560 is the fourth, not the third. The number to hold is the *tile width*, not the column count. `e2e/z-responsive.e2e.ts` holds the tiers and the no-sideways-scroll rule.
- A **tile**: header (label + subtitle + key hints, on `--gf-raised`) and body (`--gf-pad-y` / `--gf-pad-x`). One tile is focused.
- Inside tiles, content is **rows** (grid columns, 1px rule between) or **cards** (kanban only).
- **Small layouts** (mobile-first): below laptop width the desk is a single column and tiles stack in workspace order; the kanban scrolls horizontally *inside* its tile, never the page; drag works on touch (long-press to lift); the bar collapses to workspace numbers + counts (below 900px; the crumb goes at 600px, but `trash` and `settings` never do — they are the only way to reach those pages). The tile grid appears at ≥1440.

## 6. Components (as built in the mockups)

The component sheet on the canvas uses wider gaps than the pages (a reference sheet, not a layout); pages use `--gf-gap` (12px).

- **Attention row** — `[n] KIND  id  Title / meta  ⟨key⟩`. Kind in mono caps; `--gf-human` when the kind is re-arm or answer. Selected row: `--gf-raised` + 2px `--gf-system` left inset.
- **Frontier row** — `≡ id  Title  STATE·note`. State marks: ◆ ready (`system`), ● building (`live`; breathes only when a run is alive, S5), ◇ blocked (outline `mute`), ▪ backlog/todo/planning (`draft`). Blocked titles go `mute` and strike through; never dim with opacity.
- **Refusal message** — mono, `--gf-mute`, one sentence, inline where the drop was refused, fading in over 120ms, no modal; it clears on the next drag or click, or after 4s. Two kinds. A **structural** refusal (no such arrow) is generated from the status pair: *a ticket in review does not go back to building*. An **owner** refusal (the arrow exists but isn't yours — S5) reads the table entry's owner and hint: *the controller moves this when the PR merges* · *re-arm needs you: press R*. A guard refusal names what is missing: *approve needs a ticket design*.
- **Kanban column width** — columns stop growing at 280px. A board spans the desk (`is-span`) because eight statuses need the room, so it is the one tile the column tiers do not narrow; without a cap an ultrawide simply makes every card 400px wide, which is the same failure the tiers exist to prevent.
- **Kanban card** — id + note (right, coloured by meaning), title, meta; a running card has a 3px meter. Column headers are the lifecycle; the controller's moves are stated, not implied. The whole card is the drag target — no grip. While a drag is live, columns the card has an arrow to take a 1px `--gf-system` border and `--gf-raised` fill; the rest go `--gf-mute` in the header. Never opacity.
- **Dependency tile** — one section per direction (`blocked by`, `blocks`), peers rather than a kv table, because an edge is one fact with two ends and either end may declare it. Edges that are no longer in the way keep their place, struck; a *trashed* end is not struck but labelled `in the trash`, because it is suspended rather than settled and re-blocks on restore (ADR-0009). Removal hangs off the blocked end (ADR-0004), so an edge whose *blocked* end is trashed cannot be undone from here: that row loses its `×` and its note says `— restore to edit` rather than leaving the absence unexplained.
- **Dependency graph** — diamond nodes, orthogonal edges, dashed edge when the source can't proceed. The running node is `live` and breathes (opacity, `--gf-breathe`). Legend is copy, not a key.
- **Ticket picker** — how you name another ticket (the dependency tile's `+ add`). A labelled hairline (mono caps label · the control · 1px `--gf-rule` running out to the edge — the control sits beside its label, never across a wide tile from it), then an open input bordered `--gf-system`, then candidates in the ordinary **row** shape — key, title, status chip — so what you choose from looks like what you get. The highlighted candidate takes the Attention row's selected treatment (`--gf-raised` + 2px `--gf-system` left inset); `↑↓` moves it, `⏎` declares. Candidates that are `done`/`cancelled` sort last and go `--gf-mute`: still legal to declare, rarely what you meant. The refusal lands under the picker, never at the foot of the tile.
- **Meter** — three columns: lowercase mono label (52px) · 4px track on `--gf-rule` with fill by meaning · mono 500 15 value right-aligned (`$1.42 / 5.00`).
- **Chip** — 1px border, mono 11, coloured by meaning when it carries state.
- **kv row** — 100px mono label column, value column. Used for ticket state.
- **Design revision row** — *parked until S6.* S1 has no revisions or shas (ADR-0005); a design's history is the ticket/project history tile. When proposals return: `rN` in mono (`--gf-human` when proposed), summary, status right.
- **Planning message** — 72px speaker column (`you` in `system`), text.

## 7. Motion

Hover/focus/selection: 120ms. Tiles and rows moving: 200ms. One ambient animation only — the live run's node breathing. Under `prefers-reduced-motion` transitions collapse to instant and the breathe is `animation: none` (not 0s, which flickers). No marquee, scanline, pulse-glow, or spring.

## 8. Interaction

Keyboard first, Linear-style: `j/k` move, `⏎` open, `a` approve, `r` re-arm, `s` status, `c` create a ticket in the current scope, `v` view options, `d` deps, `p` plan, `esc` back, `⌘K` anything, `⌘1–6` focus a tile. Every tile header shows its keys. Drag exists for kanban (S1) and claim order (S5); keys always do the same thing. A kanban drag *is* a transition: the board offers only the columns the dragger owns an edge to, and a refused drop shows the transition table's `hint` inline.

Authority is visible: transitions the controller owns are never offered as drags; a refused move says who owns it.

**As built (S1, issues 02–03):** `e` edits inline — the `about` tile on an App or Project, the description on a Ticket, the prefix on `/settings`; `c` creates a Ticket in the scope on screen — the top of `backlog` on the board, prefilled on an App or Project view, nothing on the all-apps/all-projects lists; `v` opens the board's view options; `⌘⌫` trashes the Ticket you are looking at, with no confirm (the trash is the undo). In `/trash`, `r` restores (re-arm arrives with runs, S5, and will take `r` on the board — the trash keeps it, the two never share a screen). `⌘⏎` saves any inline form, `esc` cancels it. From issue 07 that holds for forms only: text fields on a view are always live and save themselves, so there `e` focuses the focused tile's editor (a jump, not a mode), `⌘⏎` flushes and blurs, `esc` blurs, and there is no cancel — the tile header carries a `saving…`/`saved` state where the save key used to be. `n` is retired: an App or Project form opens from a `+` in its tile header until `⌘K` (issue 10) makes creation reachable by name. The bar carries `trash` and `settings` links at the right, after the counts, for the same reason.

**Kanban card, as built:** the note beside the key is the status itself, coloured per §3 — S1 has no approval state, PR or run to say anything more honest. `app / project` (`—` for an orphan) and `updated` are view options; the key and the note never hide.

**As built (S1, issue 07):** every long text field on a view is the editor and the read view at once — a ticket's description, its `design` tile, a Project's `design` tile, and an App's or Project's description inside `about`. There is no edit mode, no save button and no cancel: typing saves itself after a beat, on blur, and on the way out of the view, and the tile header carries `saving…` then `saved` where the save key used to be. `e` jumps into the focused tile's editor (the first editor on the page when the focused tile has none — tile focus is static until `⌘1–6` lands in issue 10, so a second editor on the same view is a click away for now), `⌘⏎` flushes and lets go, `esc` lets go. Undo is `⌘Z` while you are in the field and the edit session in history once you have left it.

**The mode line (S1, issue 07):** a field with the caret in it grows a status bar along its bottom edge — the tiling-WM idiom of §1 applied to writing, not a floating bubble or a ribbon. Mono, lowercase, groups divided by hairlines: `h1…h6` · `b i code link` · `list 1. task quote fence`. An active control takes `--gf-system`, like a focused tile. Every control names its key in its tooltip, so clicking teaches the keyboard rather than replacing it — `⌘B`, `⌘I`, `⌘E`, `⌘K` for a link. The right slot is the contextual one: the URL field on `⌘K`, the language of the fence you are standing in (markdown's ``` is not in the document, so this is the only place to read or change it), and otherwise `⌘⏎ done`. It is placed out of the layout, because a bar that appears between a mousedown and its mouseup moves whatever you were aiming at. An inline field shows the marks only. A mark toggles on whatever the caret is pointing at: with nothing selected, `code` inside a code span takes the span off, because the backticks are not in the document and the span is the only thing there is to point at. A selection means the selection.

**Markdown shows itself where the caret is:** the span the caret is on grows its markers — `` ` ``, `**`, `*`, `~~` — in `--gf-dim`, the handle colour, because that is what they are. A rendered span otherwise hides where it begins and ends, and markdown is what is actually stored (ADR-0005). They are decorations, not characters: the document is rich text and the markers exist only in the serialised form, so there is nothing to put a caret between and nothing to delete — taking a span off is `⌘E` or the mode line. A fence is left out: its ``` would need two lines the block has no room for, its language is already in the mode line, and a marker that appears on entry would shift the page. The `about` tile of an App or Project keeps an explicit `edit` form for the fields that are not prose — a name, a repository, an app — because those are choices, not writing. Designs render as prose: sans body, mono only for `code`, headings at row-title weight.

**As built (S1, issue 04):** a card drags to any column it has an arrow to; the move is optimistic and rolls back with the refusal message on a `409`. Drop *position* means nothing — there is no claim order in S1, so there is no insertion line, only the column. `cancel` is a button, not a drag: the `cancelled` column is hidden unless you switch it on. The Ticket view's `state` tile carries the same arrows as buttons, derived from the same table, in reading order, with `cancel` and `trash` in a separated group below — `cancel` is an ordinary transition, `trash` is the destructive one. `approve` is offered even when its guard will refuse it: a button that explains itself teaches more than a button that isn't there. The `simple` toggle sits in the same tile, next to what it gates. History reads `approved · planning → ready` — the verb first, the arrow after.

## 9. Voice

Short, plain, sentence case. Kinds and states are single words (`approve`, `re-arm`, `answer`, `needs you`, `building`). Meta lines say what happened, not what it means (`verify failed twice, same failure · $3.80 spent`). Hints are verbs with a key (`A approve`, `⏎ reply`). No exclamation marks. Numbers are honest: `$1.42 / 5.00`, never a pie chart.

## 10. Deliberately not specified

Light mode (dropped for now). When it comes, accents get new values, names stay — `--gf-page/-tile/-raised` are theme-neutral names; the accent hexes and `--gf-dim`'s "fails contrast deliberately" are dark-mode facts. Icons (none yet — marks are glyphs and colour; add an icon set only when a glyph fails). Charts beyond meters. Illustration and characters (logo only, if ever). A TUI (explored, parked).
