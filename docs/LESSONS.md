# Lessons

Running log of things learned while building the tracker, kept from day one (v0 postmortem §7.12). Newest at the bottom. One entry per lesson: what happened, what we now do instead.

## 2026-08-27 — schema at open, not only via `drizzle-kit push`

ADR-0001 says `drizzle-kit push` locally. That is fine for the one dev database, but every API test opens a fresh temp file and the Playwright suite opens another; shelling out to drizzle-kit per test is slow and flaky under Bun. So the seam (`api/src/db.ts`) also applies the schema idempotently (`CREATE TABLE IF NOT EXISTS` + default settings row) when it opens a database. `db:push` still exists for the dev database. Cost: the schema lives in two places (`schema.ts` and `ensureSchema`) — keep them in step, and revisit when we switch to generated migrations at first deploy.

## 2026-08-27 — `bun run --filter` takes package names, not directory names

`bun run --filter 'web' build` says "No packages matched the filter". The filter matches the `name` field (`@goblin/web`), so root scripts use `--filter '@goblin/web'` and `--filter '*'` for all.

## 2026-08-27 — the old GitHub repo held v0

`itsRoze/goblin-foundry` already existed with the retired v0 codebase. Its history was parked on a `v0` branch before `main` was replaced by S1, so the postmortem still has something to point at.

## 2026-08-27 — `drizzle-kit push` does not speak `bun:sqlite`

drizzle-kit connects with `better-sqlite3` or `@libsql/client`, never the Bun driver, so `@libsql/client` is an `api` devDependency used only by `bun run db:push`. App code still imports nothing but `bun:sqlite` (inside `db.ts`).

## 2026-08-27 — Playwright specs must not look like Bun tests

Bare `bun test` picks up `*.spec.ts` and `*.test.ts` everywhere, so a Playwright file named `shell.spec.ts` fails under Bun with "Playwright Test did not expect test() to be called here". Browser tests are `e2e/*.e2e.ts` (Playwright `testMatch`), and `bun test` from the root stays clean without path filters.

## 2026-08-27 — on the bun-sqlite driver, only the query builder is awaitable

Drizzle's `bun-sqlite` driver types `db.run` / `db.all` / `db.get` as synchronous, so `await db.run(...)` is a no-op and the editor says so (TS 80007). The thenable surface is the query builder (`await db.select()…`, `await db.insert()…`). The seam uses sync `run` for PRAGMAs and DDL only; everywhere else, query-builder calls with `await` — a `pragma_*` table-valued function (`select … from pragma_journal_mode`) gets an awaitable read when a test needs one.

## 2026-08-27 — zod 4 reports unknown keys in `keys`, not `path`

A strict object refusing `archived_at` in a body yields one `unrecognized_keys` issue with `path: []` and `keys: ['archived_at']`. The problem+json layer (`api/src/problems.ts`) fans that out into one issue per key so every 422 issue is addressable by `path`, and the GUI can point at a field.

## 2026-08-27 — entity ids collide across kinds; event queries need both columns

`event.entity_id` alone is ambiguous: project 1 and ticket 1 both exist. Every read of events filters on `(entity_kind, entity_id)`; the index is on that pair. A test that forgot the kind saw a project's events under a ticket.

## 2026-08-27 — keyboard shortcuts race with route loading in browser tests

`page.keyboard.press('e')` right after clicking a link fires before the view that owns the `e` handler has mounted (the entity is still loading). Smoke tests wait for the owning tile to be visible before pressing a key.

## 2026-08-28 — refusing a field in a strict body needs `z.undefined(...).optional()`

`PATCH /api/tickets/:key` must refuse `status` with a message that says why (ADR-0003), not the generic "unknown field" a strict object gives. Declaring `status: z.undefined(message)` makes the key *required* (zod 4 reports `expected nonoptional` when it is absent), so the schema carries `z.undefined(message).optional()`: absent is fine, present is a 422 with the message on `path: ['status']`.

## 2026-08-28 — the browser suite shares one database, so it runs on one worker

`playwright.config.ts` starts one API process over one temp database. With the default worker-per-file that meant `apps-projects.e2e.ts` (which asserts on `group-app-1`) racing another spec creating apps. The suite is `workers: 1`; specs may assume the ids they made, in file order.

## 2026-08-29 — `drizzle-kit push` cannot add a CHECK to a table that already exists

Issue 03 added `description`/`status`/`simple`/`design` to `ticket`, with a CHECK on `status`. SQLite cannot add a constraint with `ALTER TABLE`, so drizzle-kit rebuilds the table — and its copy step is `INSERT INTO __new_ticket (…) SELECT description, … FROM ticket`, naming columns the *old* table does not have: `SQLITE_ERROR: no such column: description`. `db:push` cannot get itself out of this.

The dev database is disposable in S1 (ADR-0001, and it was empty), so the fix was to `DROP TABLE ticket` and let `ensureSchema` recreate it at the next `openDb`; `db:push` then reports "Changes applied" with nothing to do. Dropping a table also drops its `sqlite_sequence` row, which would let ticket numbers be reused (ADR-0002) — check the row count and the sequence before reaching for this, and preserve `sqlite_sequence` if either is non-empty. This is the second cost of "schema in two places"; it is the argument for generated migrations at first deploy.

## 2026-08-29 — a server-backed checkbox is not `page.check()`-able

The `simple` toggle is controlled by the ticket the API answered with, so the click does not flip it until the PATCH lands and the query refetches. Playwright's `locator.check()` clicks once and asserts the state without retrying, so it fails. Browser tests click such a control and then `await expect(…).toBeChecked()`, which polls.

## 2026-08-29 — an intent route `/:key/:name` must be registered last

Hono matches in registration order, so `POST /tickets/:key/:name` registered before `POST /tickets/:key/restore` swallows the un-trash. The transition route goes on at the end of `ticketsRoutes`, after every named route, and `restore` is deliberately not a transition name (`reopen` is the one that brings a `cancelled` ticket back).

## 2026-08-30 — `@tiptap/markdown` parses and serialises without a DOM

The canonical-form rule ("`serialize(parse(x))` is a fixed point") is the whole contract of
storing markdown only, and it needed a test that is not a browser test. `MarkdownManager` from
`@tiptap/markdown` takes a list of extensions and exposes `parse`/`serialize` on plain JSON —
no editor, no `document`. So `web/src/markdown.ts` is a pure seam over it and
`web/test/markdown.test.ts` runs under `bun test` with the rest. The React editor imports the
same seam, so what the test proves is what the field stores.

## 2026-08-30 — raw HTML in markdown comes back as the text of itself, not as nothing

ADR-0005 says raw HTML is "stripped on the next edit and never rendered". What the editor's
schema actually does is keep it as literal text, entity-escaped: `<script>alert(1)</script>`
round-trips to `&lt;script&gt;alert(1)&lt;/script&gt;` and stays there. The invariant that
matters — it is never markup, and it is a fixed point — holds; nothing is silently deleted,
which is the better half of the trade when the markdown came from a planning agent.

## 2026-08-30 — an inline-only schema drops pasted blocks in silence

App and Project descriptions use the inline configuration (emphasis, code, links). Parsing
`# Heading\n\n- one` against it produced a document with nothing in it — the block nodes have
no renderer, so the words went with the bullets. `flattenBlocks` in `web/src/markdown.ts` strips
block markers before parsing so an inline field loses its formatting but never its words.

## 2026-08-30 — a form that no longer carries a field must not send it as `''`

Pulling `description` out of the App/Project `about` form left `appBody`'s
`description: v.description ?? ''` behind, so renaming an app would have blanked its
description. Body builders shared between a create form and an edit form send a field only when
the form actually had it.

## 2026-08-30 — chrome that appears on focus must not be part of the layout

The editor's mode line was rendered in flow, so focusing a field pushed everything below it down.
Clicking a button under the field then failed: the mousedown focused the editor, the line appeared,
the button moved, and the mouseup landed somewhere else — no click ever fired. A browser test caught
it as "the ticket never left `backlog`". Chrome that comes and goes with focus is positioned
absolutely with its space reserved, so the page never moves under a press in progress.

*(Amended 2026-09-04, issue 10.)* The same rule caught a third case, from the other direction: tile
focus follows a click, so `Tile`'s `onMouseDown` runs a focus change — and giving that change a
`scrollIntoView` and a `blur()` (both right for `⌘1–6`, which has no press in flight) broke six
browser tests at once. The scroll moved the link out from under the pointer; the blur collapsed
ProseMirror's selection, so every mode-line button applied its mark to nothing. **A handler that
serves both a click and a key needs two paths**: the pointer path may only change state, and
anything that moves the page or the caret belongs to the keyed one.

*(Amended 2026-11-02, GF-9.)* A fourth case: the focused tile's `j k ⏎` hint was rendered only on
focus, in a right-aligned header, so taking the focus on mousedown slid the `+` beside it 68px and
the first click on an unfocused tile's button did nothing. Reserving the space in flow serves the
rule as well as absolute positioning does: the hint is always in the header, `visibility: hidden`
until its tile is focused.

## 2026-08-30 — a live field is owned by the field, not by its document

Clicking from the editor into the mode line's own URL or language input blurs the *document*. The
flush-and-reconcile that hangs off that blur then saved, refetched and replaced the document under
the control being used, throwing the change away. Focus is tracked with `focusin`/`focusout` on the
field's container instead, so the caret can visit the field's own chrome without the field deciding
you have left.

## 2026-08-30 — moving focus out of ProseMirror collapses the selection

`⌘K` on a selected phrase opened a URL field, and by the time the URL was submitted the link landed
on an empty caret instead of the phrase. Focusing anything outside the editor collapses
`state.selection`, so a command that needs the old range has to carry it: the range is captured when
the slot opens and restored with `setTextSelection` before the command runs. A code fence's language
is worse — the caret is gone, so the block is addressed by its own node position and rewritten with
`setNodeMarkup`.

## 2026-08-30 — a toggle on a collapsed caret has to mean the span

`toggleCode()` with nothing selected only sets a stored mark, so putting the caret inside
`` `parse` `` and pressing the `code` button lit the button and changed nothing — the only way to
undo the input rule was to select the word first. Markdown's backticks are not in the document, so
the span is the only thing a caret can point at: a collapsed selection now runs `extendMarkRange`
before the toggle, from the mode line and from `⌘B`/`⌘I`/`⌘E` alike. A real selection is left
alone, since there you did say what you meant.

## 2026-08-30 — Slack does not reveal its backticks; the pattern still earns its place

Asked to match "Linear and Slack", the research did not support the premise: a primary account of
Slack's WYSIWYG composer says the raw characters are never exposed, and Linear's editor docs do not
mention it either way. (A search engine's summary claimed the opposite; the linked source said the
reverse — read the source.) The pattern is real elsewhere — Obsidian and Typora do it, and
`prosemirror-codemark` solves the neighbouring "will the next character be code" problem with a
drawn cursor — so it was built anyway, on its own merits.

The structural difference matters and is worth remembering: in Obsidian the document *is* markdown,
so the revealed characters are real and editable. Here the document is rich text and markdown is the
serialisation, so the markers can only be decorations. *(Amended 2026-08-30: this entry went on to
say they are "not something to put a caret between". The caret cannot literally go there, but the
arrow and backspace models below simulate it convincingly, which is the point of `stepMark`. What
remains true is that a real source mode — editing the markers as text — is a different feature.)*

## 2026-08-30 — `selectionchange` is async, so a decoration test must retry

A probe of the reveal read the DOM straight after `dblclick()` and saw the *previous* selection's
markers — the code span's backticks while the caret was on the bold. Chrome dispatches
`selectionchange` asynchronously, so ProseMirror has not re-run its decorations yet. Browser tests
assert with `expect(locator).toHaveText(...)`, which retries; a bare `innerText()` reads one
selection behind and looks like an off-by-one bug in the plugin.

## 2026-08-30 — refocusing the editor re-enters the handler that did it

The link slot's `esc` called `restore()` to put the caret back, which moves DOM focus out of the slot's
input — firing its `onBlur`, which was `commit`. So `esc` applied the link it was meant to cancel, and
`enter` ran `commit` twice (inserting the URL text twice when there was no selection to wrap). Any
handler that returns focus to the editor has to assume it will be re-entered through blur: the close
path now holds a `closing` ref and runs once.

## 2026-08-30 — key presses outrun `selectionchange` too

Already known that reading the DOM straight after a click sees the previous selection. The same
asynchrony bites when *writing*: a loop of `ArrowLeft` presses followed immediately by `ArrowUp` left
ProseMirror still believing the caret was where the typing ended, so a handler keyed on
`parentOffset === 0` never fired and the feature looked broken when it was not. Browser tests place a
caret with a click and let it settle before pressing the key under test.

## 2026-08-30 — read the guard clause, then check it actually runs

`@tiptap/extension-code-block` has `exitOnArrowUp`, and its source reads as though it handles a fence
that opens the document (`if (before > 0) return false` — so `before === 0` proceeds). It does not fire
in practice. The conclusion "the source says it is handled" was wrong and a review caught it; a probe
would have caught it sooner. `OpenFence` in `web/src/markdown.ts` now does the job, with a browser test
that would fail if the extension ever started doing it instead.

## 2026-08-30 — `EditorContent` puts a div between you and the document

Making the design field fill its tile (`flex: 1` down the chain) did nothing: `@tiptap/react`'s
`EditorContent` renders its own wrapper div around `editor.view.dom`, so `flex: 1` on the document was
being applied inside a parent that was not a flex container and had auto height. The wrapper takes a
`className`, so the growth is handed down through `.gf-md-content` explicitly. Measuring the boxes
found it in one pass; guessing at the CSS would not have.

## 2026-08-30 — a widget only moves across the caret if it inherits the mark

Showing which side of a revealed marker the caret is on needs the marker's DOM to move relative to
it. Flipping the widget's `side` did nothing: with `marks: []` — added so a backtick does not render
*as* code — ProseMirror keeps the widget outside the run's element either way, so all four states
produced identical DOM. The marker only crosses the caret when it is allowed to inherit the run's
mark and render *inside* `<code>`. The rule is `marks: []` wherever the marker falls *outside* the
run's element — which is an opening marker the caret has not passed, and a closing one it has —
and inherited marks wherever it falls inside. The decoration picks per side. Two consequences: the run's element text then
includes the marker (assert with the caret away), and `.gf-syntax` has to outrank the run's own
colour rule.

This is the part `prosemirror-codemark` solves with a drawn fake cursor. Letting the real caret do
the work is cheaper and has no second cursor to keep in sync, but it only works because there is a
marker there to move — it would not generalise to marks we do not reveal.

## 2026-08-30 — Obsidian does not need a `stepMark`, and that is the whole difference

Asked to research Linear and Obsidian for the caret-at-a-marker problem. Obsidian's Live Preview
states its goal as "only displaying Markdown syntax around the cursor", which is the behaviour we
copied — but it needs no arrow-key model at all, because its document *is* markdown: the backticks
are characters, so arrows move through them and backspace deletes them without anyone writing code.
Everything in `stepMark` and the backspace rule exists only because our document is rich text and
the markers are drawn. That is why the ProseMirror ecosystem has `prosemirror-codemark` and Obsidian
has no equivalent.

Linear's behaviour could not be confirmed this round either — its editor docs say only that markdown
"will be converted into rich text automatically". Two rounds of looking have now failed to verify
anything about Linear specifically; the design rests on codemark and Obsidian, not on it.

## 2026-08-30 — the arrow model has four stops going right and three going left

`stepMark` gives a run four visible positions, but only rightward. Arrowing *left* off the first
character lands on the run's opening edge, where ProseMirror takes the marks of the *preceding* text
— so the caret is already "outside" and the inside-the-opening-marker stop is skipped. It is a
missing stop rather than a trap: leftward you end up outside the mark, which is where you were
going. Making it symmetric would mean intercepting an ordinary move to set `storedMarks`, which is
more machinery than the asymmetry costs.

## 2026-08-31 — style the editor's document by our own class, not ProseMirror's

Rebasing onto the stylelint main added brought 30 `selector-class-pattern` errors: the editor's CSS
hung off `.tiptap`, which is ProseMirror's class and matches neither `gf-` nor `is-`. Adding an
exception for it would have been the easy read of the rule. The honest one is that a house selector
should be the house's: TipTap takes `editorProps.attributes.class`, so the document carries `gf-doc`
and the stylesheet never names a third-party class. The other two errors were real too — a focus
reset declared after the rules it resets, and a `box-shadow: none` that resets a shadow this house
never has (DESIGN.md Elevation & Depth).

## 2026-08-31 — the field's own paste handler was hiding a feature that already existed

Asked whether pasting a URL over a selection could link it, the way Linear does. It already could:
`@tiptap/extension-link` ships `linkOnPaste` on by default. The field never saw it, because a
ProseMirror view's own `editorProps.handlePaste` runs *before* any plugin's, and ours returned true
for every plain-text paste in order to parse it as markdown. It now declines a bare URL dropped on a
selection and lets the extension have it.

The same reading turned up the other half: `openOnClick` defaults to `true` and had been switched off
when the editor was first configured — reasonable for an editor, wrong here, because this field is
also the read view (ADR-0005) and a link you cannot follow does not work. `whenNotEditable` is no
help for an always-editable field; the source collapses it to `true` regardless.

Before adding an affordance, read the extension's defaults: twice now the behaviour was already there
and something of ours was in front of it.

## 2026-09-02 — `bun link` from a worktree leaves a symlink into a directory that will not last

`bun link` in `cli/` installs the package's `bin` as `~/.bun/bin/goblin` — pointing at whatever
directory you ran it in. Run from a feature worktree, `goblin` breaks the moment that worktree is
removed, and the breakage shows up later, in an unrelated shell. Install from the main checkout;
`bun unlink` (from the same directory) takes it back out.

## 2026-09-02 — `VACUUM INTO` runs on a read-only connection, WAL and all

ADR-0001's backup carve-out assumed it would: it does. A `Database(path, { readonly: true })` runs
`VACUUM INTO ?` while `bun dev` holds the same file open, reads through the `-wal`, and writes one
settled file the schema opens with no recovery step. So `goblin backup` never needs the server
stopped, and never needs a second writer.

## 2026-09-02 — `graph.ts` and `graph.tsx` cannot both exist

Issue 08 asked for a pure `web/src/graph.ts` (the dagre layout) and a `web/src/graph.tsx` (the
SVG renderer). Both resolve from the same bare specifier: TypeScript and Vite try `.ts` before
`.tsx`, so `import … from '../graph'` in the Project view would always reach the layout module
and never the component, and the extension cannot be written out without
`allowImportingTsExtensions`. The pure module keeps the plain name it is tested under
(`web/test/graph.test.ts`) and the renderer is `graph-view.tsx`. Two modules in one directory
need two stems, not two extensions.

## 2026-09-02 — impeccable reads the root, and takes Bun workspaces for apps

impeccable (the design skills, installed as a project-scoped plugin via `.claude/settings.json`) looks for `DESIGN.md` at the repo root, then `.agents/context/` and `docs/`, never `design/`; so the root `DESIGN.md` is a symlink to `design/DESIGN.md` and the house style stays where it was. Its detector enforces only tokens it can parse, so `design/DESIGN.md` now opens with a YAML copy of `design/tokens.css` plus the Typography heading steps (tokens.css changes first, the block second). The house then adopted impeccable's DESIGN.md shape outright, `/impeccable document` regenerating tokens and sections from the CSS and the prose merged in by hand; anything that cites a `DESIGN.md §n` (tickets, PR bodies, `.stylelintrc.json`, `.impeccable/critique/ignore.md`) has to be renumbered when the sections move — done on 2026-09-03 by `/impeccable document` (merge): the eight canonical headings plus Motion, Interaction, Voice and Deliberately not specified preserved after them, every `§n` citation in the repo rewritten to a section name, and the old-to-new map kept in the file's preamble for PR bodies and history. The Bun workspaces make the repo a monorepo with four "apps" in impeccable's eyes; `.impeccable/config.json` names `web` and negates the rest — negating `web` too would make the detector stop inheriting DESIGN.md for `web/src` — and a command with no file to anchor on still asks which app; answering moves its working directory to `web/` (snapshots and `ignore.md` with it), so name a file (`web/src/pages/Board.tsx`) instead. Its boot prints `MANUAL_DETECTOR_REQUIRED` because it looks for the hook in `.claude/settings*.json` and cannot see a plugin's; the hook is running regardless, and `/impeccable hooks on` must not be the answer: it writes a `.claude/settings.local.json` hook pointing at `.claude/skills/impeccable/…`, which this repo does not have. Its edit hook files design-system drift (a colour, radius or size outside the YAML block) under *advisory* and says nothing about it until `detector.advisoryRules` is `include`, which it now is; `/impeccable doctor` then lists `advisoryRules` as a `detector` key nothing reads, which is the doctor's known-key list lagging the hook that does read it. What the plugin does on its own: a PostToolUse hook on every Edit/Write and a Stop deep pass in every session here, a cache in `.impeccable/hook.*.json` and an ignore block written into the worktree's `.git/info/exclude`, a once-a-day version poll to impeccable.style recorded in `~/.impeccable/update-check.json`, four `impeccable-*` subagents, and a one-time prompt to enable the plugin in each checkout that reads `.claude/settings.json`. The `npx impeccable install` route was not taken: it vendors ~5 MB of skill into `.claude/skills/` and its CLI lagged the plugin (3.6.1 against 4.1.3) on the day.

## 2026-09-03 — the stylesheet linter catches what you wrote, not what you left out

Issue 06's close-out found three colour defects in one screen, and `bun run lint` was green through all
of them, because each was an *omission*: a `<button>` inherits no `font-family`, so the filter chip
rendered in the UA's Arial beside mono siblings; a `<input type="checkbox">` with no `accent-color`
paints in the browser's saturated blue, which in this house means a link and nothing else; and
`::placeholder` with no rule is `#757575`, 3.1:1 on `--gf-page`, under the 4.5:1 the text-safe rule
asks of anything carrying words. `lint:css` refuses a hex literal and `lint:dead-css` refuses a class
nobody uses; neither can see a property nobody declared. A new form control gets its font, its accent
and its placeholder colour written down explicitly, and the check for that is a rendered screen — the
close-out's `/impeccable critique` measured all three off the running page.

## 2026-09-03 — a picker's `⏎` is only as warm as its query key

The board's ticket read and the dependency picker's both went through `useTickets()`, so navigating
from the board to a Ticket view left the picker's candidate list already in cache: `fill('dependent')`
then `press('Enter')` picked the one hit immediately. Issue 06 gave the board a different cache key
(its query now always names the status set it draws), and the picker's list became a cold fetch —
`hits` was empty for a beat, `⏎` had nothing to pick, and it silently did nothing. `deps-blocks` still
*contained* the ticket's title, because the open picker renders its candidates inside that tile, so the
assertion above the failing one passed and the symptom read as "history did not refresh".

Two things came out of it. A browser test that presses a key to choose something waits for the choice
to be on screen first (`toHaveCount(1)` on the options), the same rule as waiting for the tile that owns
a shortcut. And the picker now says `loading…` rather than `no ticket matches` while its query is in
flight, because the second sentence was a lie for as long as the race lasted.

## 2026-09-03 — ProseMirror keeps its selection after a blur, so a decoration outlives the caret

`e2e/writing.e2e.ts` failed about one run in three, a different caret test each time, and the cause
was not timing at all: `RevealSyntax` derived its decorations from `state.selection` alone, and a
blurred editor still *has* a selection. So `⌘⏎` (which flushes and calls `view.dom.blur()`) left the
revealed `` ` `` and `**` on screen whenever the save round-trip did not happen to replace the document
and reset the selection — the field went on reading as markdown source after you had left it, which is
the opposite of what DESIGN.md Interaction promises ("markdown shows itself *where the caret is*").
The test looked flaky because whether the reconcile landed was a race; the bug underneath was constant.

Focus is now plugin state, flipped by the view's own `focus`/`blur` DOM events. It has to be state
rather than a `view.hasFocus()` read inside the decorator, because **losing focus is not a
transaction**: nothing would recompute the decorations to notice. The general rule: a decoration
derived from the selection needs focus in its inputs, or it draws for a caret that is not there.

## 2026-09-03 — a key that acts on what another key just chose must not wait for state

Issue 10 gave the shell one `a`/`s`/`d` binding and let each screen say what those verbs do to
the current Ticket. The first wiring put the current Ticket's *key* in context state and gated the
bindings on it (`key === null ? undefined : …`). Pressing `j` then `a` did nothing about half the
time: `j` commits the Cursor and paints `is-cursor`, but the offer only reaches the shell in that
commit's passive effect, which re-renders the shell, whose own effect then refreshes the key map —
two render/effect cycles *after* the mark a browser test (or a fast human) can already see.

The screen's verbs now go into a **ref**, written in the same commit that draws the Cursor, and the
global keys read that ref; the key stays in state only for what genuinely has to re-render, which is
the palette's ticket read. The rule: anything reached by a keystroke should be published where a
keystroke can see it immediately — state is for rendering, a ref is for handlers. A browser test
that presses a key acting on a selection still waits for the selection to be on screen first, but it
is no longer waiting for two invisible cycles behind it.

## 2026-09-16 — WebKit gives every `Error` its own `line`, and an own property beats a getter

`ProblemError` carried its one-sentence refusal as a getter named `line`. Under WebKit — Playwright's
engine for iOS Safari, so also the phone in your pocket — every `Error` instance is born with own
`line`, `column` and `sourceURL` properties, and an own property shadows anything on the prototype.
So on iOS every refusal read as `74`: the source line the error was thrown from. Chromium never
showed it, and neither did a probe that only *counted* refusals. The getter is `sentence` now. Two
rules: a name on an `Error` subclass is only yours if no engine has claimed it, and a test that
proves a message is there has to read the message.

## 2026-09-16 — a later rule wins, and a phone tells you by growing the page

The card menu set `right: 0` to hang from the card's edge, and `.gf-pop`, declared further down the
stylesheet at the same specificity, set `left: 0`, so the menu hung off the right instead. Desktop
Chromium showed nothing wrong — the panel ran past the viewport and the page could be scrolled to it
— but under `isMobile` emulation the layout viewport grew to fit the overflow and the whole page
zoomed out, which is how a phone reports a 200px mistake. When a component borrows another's
clothes (`.gf-pop`) and overrides one of them, the override is `.gf-pop.gf-card-menu`, not a bare
class that happens to sit earlier in the file; and the no-sideways-scroll check is worth running
with every popover open, not only on a quiet page.

## 2026-09-17 — a query builder is a thenable, and an `async` function runs what it returns

Issue 03b needed writes that are *planned* now and *run* later, inside one atomic batch
(ADR-0010). The obvious shape — `async function eventWrite(…) { return db.insert(event)… }` —
executes the insert on the way out: a Drizzle builder has a `then`, and a promise resolving to
a thenable calls it. The statement would have run outside any transaction, silently, and the
batch would then have run it a second time. Anything built-but-not-run travels inside a plain
object (`AtomicWrite { what, statement }`), which has no `then`. The rule: never let a query
builder be the return value of an `async` function or the argument of `Promise.resolve`.

The same ticket settled what "atomic" means on this driver. Drizzle's `transaction()` on
`bun-sqlite` is synchronous, so an `async` callback commits at its first `await` — the wrapper
looks like a transaction and is not one. `atomically()` in `db.ts` takes a *list* of built
statements and runs `BEGIN IMMEDIATE … COMMIT` in one synchronous block, which is also the
shape D1's `batch()` and a Durable Object's `transactionSync()` honour. Validation-only tests
would have passed against the broken version; the evidence is a trigger in the test database
that makes the second ticket's history insert abort after the first ticket's writes have run
(`api/test/harness.ts` `failWrites`), and deleting the `BEGIN` turns those tests red.

## 2026-09-17 — a checkbox is an `<input>`, and the keys go quiet behind it

`useKeyMap` silences every key while the target is an `INPUT`, which is right for text and
wrong for the card's Selection checkbox: click one and it keeps the focus, so `j`, `x` and
`esc` died until you clicked elsewhere. Exempting every checkbox broke the status filter, whose
popover *relies* on its focused checkbox swallowing the shell's `esc` (it answers `esc` itself
and the shell would otherwise also walk back a page). So passing keys through is opt-in, per
control: `data-passes-keys` on the one checkbox that takes no keys of its own. The rule: a guard
that reads the DOM's tag is a guard on every future element with that tag — widen it by
naming the exception, not by redefining the class.

## 2026-09-17 — `?q=` is a substring over everything the earlier specs left behind

The selection spec narrowed its board with `?q=Tick ` and passed alone, then failed in the full
run: the filter trims and matches substrings, so `Tick` found every "ticket" the earlier specs
had made, and the Cursor's first `j` landed on somebody else's card. Fixtures that are found by
text are now coined words (`Tickbox`, `Shiftrange`, `Bulkaccept`). A spec that shares a database
picks names no English sentence contains.

## 2026-09-17 — `launchctl bootout` returns before the job is out

`goblin service stop` booted the agent out, then read `launchctl list` to report on it, and
reported `loaded: true` about an agent it had just stopped — the port was already dead, so the
*process* was gone, but the job was still in the domain for a fraction of a second. The same
race is why a `bootstrap` straight after a `bootout` is sometimes refused. So `bootout` in
`cli/src/service.ts` does not return until `launchctl list` stops answering (twenty 100 ms
looks), and `reload` is then just bootout-then-bootstrap. Cost: nothing when the job has
already gone, which is every time it was not loaded to begin with.

## 2026-09-17 — a failed `bun run build` says nothing useful on stderr

Under `bun run --filter`, vite's actual reason arrives on **stdout**, one line at a time behind
a `@goblin/web build: ` prefix; stderr carries only bun's own `$ bun run --filter …` and
`error: script "build" exited with code 1`. So "quote the last line of stderr" — the obvious
way to put a shelled-out failure into a message — quotes noise, and there is no single line
that is the reason. `goblin service restart` therefore says the build failed and names
`bun run build`, rather than relaying an output that would also have to be prose on a stderr
that carries only problem+json.

## 2026-11-02 — a cached route keeps its component, and what it was holding

`TicketView` rendered `<Empty>` while a Ticket loaded, which unmounted `TicketLoaded`, so moving to an unvisited Ticket always started clean. A Ticket already in the query cache skips that render, and React kept the one instance. An open picker, a title editor and an idle write all carried on against the next Ticket's closures (GF-76). The rule: a view whose route parameter names an entity is keyed on that entity's id at its loaded component. A test of this visits both entities first, or it takes the loading path and passes for the wrong reason.

## 2026-11-02 — TipTap's `Markdown` extension grows `marked` per editor

The extension builds a `MarkdownManager` per editor, and each one adds its tokenizers to `marked`'s global list for good, so every parse slows with every editor ever mounted. Keying the entity views (GF-76) put each cached move on the mount path, and a round trip between two 30 KB Tickets took 2862 ms after 40 trips, against 272 ms on the first. The app parses through `managerFor`, so the extension did nothing for it and is gone: 130 ms, and 139 ms on the first. Those are medians of five runs per side. The rule: count what a per-instance extension registers globally before mounting it per field.

## 2026-11-02 — `overflow-x: auto` is a scroll box on both axes, so a popover inside it is cut off at the foot

The card menu hung from its card as `position: absolute`, and the kanban (`.gf-cols`) scrolls sideways with `overflow-x: auto`. A non-`visible` overflow on one axis makes the other `auto`, so the kanban was a scroll box top to bottom too: the last card's menu ran past the kanban's foot, `trash` sat behind the edge, and the kanban grew an inner scroll nobody asked for (GF-78). The viewport check that flips the menu above its card never fired, because the viewport had room; the kanban did not. The menu is now fixed to the screen from the `⋯`'s rect, as the palette and the drag ghost already are, placed again on every render, scroll and resize since a fixed panel does not follow its card on its own, and closed when the `⋯` leaves view. The rule: a popover inside a scroll box is placed on the screen, not in the box, and the check for "does it fit" is against whatever clips it.

## 2026-11-02 — a control that vanishes under the focus hands `⏎` to the Cursor

Chromium blurs a button the moment it becomes `disabled`, and a link that unmounts takes the focus with it: either way the DOM focus falls to `body`, and `⏎` there is the Cursor's, which opens a row the hand was nowhere near (GF-80). The graph's `+` did the first at 200%, and the popover's title link did the second when Tab left the last node, since the node's blur hides the popover; a popover tall enough to scroll did it a third way, as Chromium makes a scroller a Tab stop and the same blur emptied it. The zoom buttons are now `aria-disabled` at the ends of their range, as the inert fields already are, the popover's title is text, since clicking the node opens the same Ticket and the only route to the link was Shift+Tab from the next field while the pointer held the node, and the detail region is `tabindex=-1`. The rule: a control that can go away while it holds the focus dims with `aria-disabled`, or is text. The other `disabled={busy}` buttons, which disable under the click that pressed them, are the same shape and are not yet audited.

## 2026-11-02 — prosemirror-view's focus timer writes the editor's caret over the browser's

`handlers.focus` arms a 20 ms timer on the focus event that finds the view unfocused. When it fires it calls `selectionToDOM` if the DOM selection differs from the one the editor last wrote. A browser test clicked the field, typed sixteen keys and pressed four arrows inside 40 ms. Chromium ran that input ahead of the overdue timer, so it fired among the arrows, before the `selectionchange` the editor reads, and put the caret back where the typing ended (GF-94). Measured with no forced delay: 2 of 3 with no gap between typing and arrows, 0 of 30 with 8 ms or more, 0 of 71 after a 300 ms settle, 0 of 71 in WebKit. A person leaves gaps of 50 ms or more between keys, so the test's own burst is the trigger. The test now waits for the idle save's `saved` before the arrows. The save is a later and longer timer than the focus timer, so it runs after it, and by then the two selections agreed and the focus timer had nothing to write. `saved` is sticky, so this proves it only for the field's first save. A person does reach the same timer another way: freeze the page for 150 ms or more right after the editor takes focus, by a click or by `e`, and press arrows inside the freeze. That lost a key in 36 of 40 cases in both engines, and is its own ticket. The rule: a test that focuses a field and then sends a burst of keys whose outcome depends on the browser's caret lets a later product timer land first. No wait after the keys brings back a caret the editor has already overwritten.

## 2026-11-02 — an effect that syncs a prop into state also runs on mount, after whatever got there first

The board's text filter kept what was typed in state and copied the address's `q` over it in `useEffect(() => setTyped(settled), [settled])`. React defers a mount's effects to a later task when the commit that drew the screen used up its time slice, so on a slow machine a keystroke could land between the two; the effect then ran for the first time after it and put the empty `q` back, and the address stayed `/` with no error (GF-95, one CI run in ten, never on a laptop). State that follows a prop is adjusted in the render that sees the prop change, React's documented pattern, which never runs on mount. A forced reproduction of a race like this bumps `performance.now` the instant the element is in the DOM, so React yields, and types from a `MutationObserver` callback, the microtask after the commit.

## 2026-11-02 — an empty editor document has to hold one empty paragraph

`toDoc(shape, '')` returned a `doc` with no block in it. The schema says `block+`, but ProseMirror
builds the state anyway, and with no text position to put the caret in it falls back to an
AllSelection over nothing. Clicking into the field then depended on the browser: macOS Chromium
collapsed the caret into the paragraph the focus handler had meanwhile created, Linux Chromium kept
the whole-document range, so `h1` wrapped the document and the first keystroke replaced it (GF-73).
A document the editor opens now always has one empty paragraph; paste still gets the bare blocks
(`toBlocks`), so pasting whitespace inserts nothing.

The other half of GF-73 was a test assumption. A CDP touch pan dispatched back to back is faster
than any finger, and on Linux Chromium the tap 60ms after it got its pointer events but no click.
A 400ms pause or moves paced at 60ms both brought the click back. Touch moves in a spec are paced
like a finger, or the tap that follows never clicks.

## 2026-11-02 — a state that follows a prop sees its own write come back, later than the next keystroke

The board's text filter writes the address after 200 ms of quiet and takes the address's `q` back into the box whenever it changes. `BrowserRouter` draws every navigation inside `React.startTransition`, so the write came back in a later render than any letter typed meanwhile, and the sync put the written value over the letter (GF-99). Measured on main with real key events over 80 letters per cell, in Chromium and WebKit: nothing lost at gaps of 60 to 150 ms or at random gaps of 60 to 180 ms, because a key inside the quiet window resets the timer and no write happens mid-burst; 1 to 7 letters lost at a 200 ms gap, where the key lands right behind the write; none at 240 ms and up. A person meets it at a pause of about the settle time followed by a quick key. The box now keeps the `q` values it wrote and has not yet seen, and lets those through; any other `q` still replaces it. The same comparison, made on the trimmed text, stops a trailing space from being written again every 330 ms. The rule: a control that writes a value and reads it back through a prop compares the prop with what it wrote, not with what it last saw, because the read-back can land after the hand has moved on.

## 2026-11-02 — an error boundary resets from state, and what it replays comes from the cache

*(GF-102.)* `key={pathname}` on the boundary would have remounted every healthy view whose address moved, renaming an App among them. So the boundary holds `failed` and clears it in `componentDidUpdate`, only when it was already failed before this update. A view that throws on a value in the query cache throws again on every move back, before it can mount and refetch, so a record mended elsewhere draws only after a reload.

## 2026-11-02 — an `esc` chain that counts on the focused control misses the thing that lost it

A filter popover answered `esc` only through its own focused input or group, and the board's `useEscape` chain did not know it existed. `⌘K` took the focus to the palette, the palette's `esc` closed it and left the focus on `body`, and the next `esc` walked out of the board with the popover still open (GF-98). Closing by key also let the popover unmount under the focus, so `⏎` after `esc` went to the Cursor and opened a card. The bar now hands the board a close function its chain asks first, and a close by key hands the focus to the chip whose popover was open, where `⏎` reopens the same thing with the ring to say so; a close by mouse leaves the focus where the press put it, because the browser draws no ring after a press, and a focus nobody can see is the GF-80 hazard in new clothes. The rule: everything that counts as open on a screen is in that screen's `esc` chain, whatever holds the focus, because the focus is the one thing a palette or a click can move without closing anything. And the GF-80 shape has a second case: a thing that unmounts under the focus, like one that disables under it, hands the focus somewhere first.

## 2026-11-02 — the markdown parser hands back a node the schema forbids

`fmt-orderedList` on an empty field stored `1. `, and the save's refetch died in `canonical` with `Cannot read properties of undefined (reading 'type')`, which unmounted the whole app to a blank page, on every load of that Ticket after (GF-100). A probe of the stored form, `canonical('block', '1. ')` under `bun test`, found it in a second; the browser only added which error the person saw. `@tiptap/extension-list`'s ordered-list tokenizer parses an item with no text as a `listItem` with no content, where the schema says a list item holds a paragraph, and the serialiser reads the child that is not there. `toBlocks`, which `toDoc` and paste both go through, now fills that one node with a paragraph and leaves every other node as parsed. Two wider fills failed review: one that rebuilt every node through the schema moved the words of `- # a` and dropped the text of `-\n  a`, and one that filled every empty node kept an empty quote the serialiser used to drop, which put `- >\n  a*b` on a path where a bare text child is escaped on every save, and the stored body grew a backslash a time. The rule: a parse from a library is external data at the seam, but the seam fills only what the serialiser cannot read, and the proof that it gives every string it handled before the same bytes was a harness over 217,453 generated strings and a copy of the live backup, run against both seams. A second crash hid behind the first: for `>1. \na`, marked's quote tokenizer re-read the numbered list through marked's own list tokenizer, which does not read `1. \na` as a list, and died on the nothing it got back. The seam now gives the registered tokenizers that re-read where marked's own fails.

## 2026-11-02 — a caret key right after an editor takes focus has two thieves, and both are the view's own focus handling

*(GF-96.)* Measured on main with real key events, 65 trials per cell in both engines: `e` then an arrow was lost in Chromium 23 of 65 at 20 ms, 16 at 30, 17 at 40 and 8 at 50; a click at the line start then an arrow, 19, 15, 17 and 15; WebKit lost 11 and 8 of 65 at 10 ms and none elsewhere; under a 150 or 400 ms freeze an arrow after `e` was lost 20 of 20 in both engines. In 229 of those losses a `Selection` write happened inside prosemirror-view's 20 ms focus timer, which compares the DOM observer's last snapshot with the live selection and writes the editor's caret over it. An arrow's native move is the end of its keydown task and its `selectionchange` is a later task, so a timer overdue by a React render or a freeze runs between the two and undoes the move. Nothing in JS can get between them either: a keyup sync, a microtask or a flush on the next event all come after the timer can. The other 35 losses were keys pressed 2 to 4 ms after `e`, while the element's `focus()` had left the browser's caret at the document start and the first flush had not yet put the editor's back: a letter typed there went in at the start, 28 of 65. The field now sets `view.focused` before the view's own focus handler sees the event, so the timer is never armed (0 of 3560 trials), and `e` focuses through `view.focus()`, which writes the caret in the same instant, then zeroes `view.input.lastFocus`, because the flush otherwise takes a caret that reaches the document start within 200 ms (Home, `⌘↑`) for Chrome's reset on focus and reverts it: 20 of 20 at 30 and 100 ms without that line. Both are fields prosemirror-view 1.42 keeps out of its typings. The rule: a timer that reconciles two selections by comparing snapshots loses whichever native move lands between its arming and its firing, and only not arming it closes the window.

## 2026-11-02 — Home is not a caret key in macOS WebKit

*(GF-96.)* A harness cell pressed Home after `e` and counted it lost 20 of 20 in WebKit at every gap, on main and on the fix alike. The in-page log showed the DOM caret unmoved after the key: macOS WebKit does not bind Home to the line start in a contenteditable. A spec or a matrix that needs the line start presses it in Chromium only, or arrows there.

## 2026-11-03 — a field knows its own write by the text the server holds, not by parsing it back

A letter typed after a pasted `1. ` never left the field, and the tile said `saved` (GF-104). Traced in Chromium and WebKit with real keys and a real paste: the write landed with `live` and `agreed` both `hello\n\n1. \n\n world`, the read of it came back through `canonical` as `hello\n\n1. world`, no body matched, so under the caret it became a held read, and `flush` sends nothing past a held read. On blur the held read became a false `changed elsewhere`. Undo stalled the same way. The empty list item was not the cause: `1. a` does the same, because any body the parser does not read back to itself fails the comparison. A field now knows its own write by `judged`, the hash of the server's text before any parse, and keeps its own body as `agreed` when it does; taking the canonical body there would make the field unsaved with no edit, and blur would write. A second fault sat on top: `saved` was the last write's word, so it stayed through every idle beat and every stall. It now gives way to `saving…` 2 to 13 ms after the first key, comes back only when the record is settled and no read says the server holds something else, and is no word at all while a held read, a moved body or a refusal means the next beat sends nothing. The rule: comparing two forms of a body proves nothing when the form is not a fixed point, so compare what was sent with what is held. The proof is a harness that mounts the real `MarkdownField` in a browser with a fake API and the idle beat under its control, over 12,176 pasted, typed and stored shapes and a copy of the live backup: typed letters left unsent went from 499 to 0, and false `moved` sentences from 522 to 0. Its source is in a comment on the PR, not in the repo.

## 2026-11-03 — `ControlOrMeta+End` is a different key on each platform

Two GF-104 specs passed on macOS and failed in CI with `1. world\n\nQ` where macOS gave `1. worldQ`. On Linux the key moves the caret to the end of the document, which after a list is the empty paragraph below it. On macOS it leaves the caret where the click put it. A spec that needs the caret somewhere clicks there, and a spec with a list in it clicks the list item. Reproduce a CI-only e2e failure in the Playwright image at the repo's version: `mcr.microsoft.com/playwright:v<version>-noble`, the worktree bind-mounted, and a named volume over each `node_modules`, so the macOS install stays out of it.

## 2026-11-03 — a hold that lives on the focused control ends when the focus leaves, and a hand-back can move the page

*(GF-103.)* A check popover held the bare keys through its own `onKeyDown`, so a press on its key strip, `⌘K` or `Tab` let `j` move the Cursor behind it and `v` open a menu newer than it. GF-98 had already said an open thing is open whatever holds the focus; what it holds has to follow the same rule, so the bar now claims the bare keys in the capture phase for as long as a popover is open. Two first attempts at the rest shipped a regression each, and both were caught by driving the screen rather than by the spec that pinned the fix. A highlight scrolled into sight on mount left the row armed by a query off screen, with `⏎` still picking it, so the scroll follows the armed row. And a plain `focus()` handing the focus back took the page 853px to an opener left off screen, so a hand-back uses `preventScroll` and skips what is out of view. The rule: a key that acts on a row needs that row in sight at every step that can arm it, and a hand-back is a move of the focus and not of the reader.
