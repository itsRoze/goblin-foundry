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
never has (DESIGN.md §2).

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

## 2026-09-02 — `graph.ts` and `graph.tsx` cannot both exist

Issue 08 asked for a pure `web/src/graph.ts` (the dagre layout) and a `web/src/graph.tsx` (the
SVG renderer). Both resolve from the same bare specifier: TypeScript and Vite try `.ts` before
`.tsx`, so `import … from '../graph'` in the Project view would always reach the layout module
and never the component, and the extension cannot be written out without
`allowImportingTsExtensions`. The pure module keeps the plain name it is tested under
(`web/test/graph.test.ts`) and the renderer is `graph-view.tsx`. Two modules in one directory
need two stems, not two extensions.
