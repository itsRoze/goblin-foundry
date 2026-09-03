# 07: Linear-style markdown editor for designs and descriptions

**What to build:** Ticket descriptions, Ticket Designs and Project Designs are edited in a
Linear-style rich editor (TipTap with the official `@tiptap/markdown`) and stored as markdown
only — no HTML column (ADR-0005). The editor is also the read view: there is no separate
renderer and no edit mode. A field is always live — click into it and type; it saves itself.
Ticket view gains a `design` tile beside `about`; Project view gains a `design` tile. Body
text is sans, not mono. Agents (and later `goblin`) read and write the same markdown through
the API.

**Blocked by:** 03 (Tickets with keys, kanban home, ticket view)

**Status:** done (PR #14 merged 2026-09-01, eb192fb)

- [x] `design` markdown column on project (ticket already has one), editable via `PATCH`;
      `''` normalises to `null`; events record prior/new bodies
- [x] Editor round-trips markdown to an **idempotent canonical form**: the first save may
      normalise an agent's markdown into the editor's dialect, and every save after that is
      byte-stable. Tests assert `serialize(parse(x))` is a fixed point over a golden fixture
      (headings, lists, task lists, code fences, links, emphasis, blockquote) — *not* that
      stored markdown equals what was submitted
- [x] Two configurations of one component: full block schema (StarterKit + task lists; no
      tables) for ticket description and both Designs; inline-only (emphasis, code, links)
      for app and project descriptions. Input rules on, no slash menu. Plain-text paste is
      always parsed as markdown. Raw HTML in markdown is stripped on edit, never rendered
- [x] Live editing: debounced idle write (~750ms) plus a flush on blur and on navigate-away,
      with a `saving…`/`saved` indicator in the tile header. No save button and **no cancel** —
      undo is `⌘Z`, recovery is the event log. `⌘⏎` flushes and blurs, `esc` blurs, `e` focuses
      the focused tile's editor (a jump, not a mode). Create forms stay explicit-submit, title only
- [x] A focused editor owns its field: refetches (focus, poll, an agent's write) are held and
      reconciled on blur, never applied under the caret
- [x] The `updated` event coalesces per edit session — same entity, same actor, within 5
      minutes (ADR-0008), so a writing sitting is one history line
- [x] Approve guard (04) recognises a non-empty design: `design !== null && design.trim() !== ''`
- [x] Browser smoke: write a design with a list and a code block, click away, reload, see it
      rendered identically; paste the markdown of an existing issue file and see it parse
