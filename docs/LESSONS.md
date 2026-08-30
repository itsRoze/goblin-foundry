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
serialisation, so the markers can only be decorations — visible, but not something to put a caret
between. Anything that promises otherwise would be a source mode, which is a different feature.

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
