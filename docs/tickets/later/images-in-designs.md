# later: images in descriptions and designs

**What to build:** An image can be pasted or dropped into any block editor (ticket description,
Ticket Design, Project Design) and given a width by dragging its edge. A design is often a
screenshot with three lines under it, and today there is nowhere to put the screenshot.

**Blocked by:** 07 (Linear-style markdown editor). Not in S1 — see ADR-0006.

**Status:** needs grilling

## Why this is not a small ticket

Markdown is the only stored form (ADR-0005) and history is the `event` log (ADR-0008), and an
image collides with both. Decide these before writing code:

- **Where the bytes live.** A `data:` URI keeps the "markdown is the whole record" property and
  needs no new endpoint, but a 2 MB screenshot then sits in `ticket.design` *and* in the `prior`
  and `new` of every edit session that touched it — the event table becomes an image store with
  no deduplication. A blob table plus `GET /api/images/:id` keeps bodies small and stays inside
  `goblin backup`'s `VACUUM INTO`; a directory beside `foundry.db` is simplest and is the one
  option backup would silently miss.
- **What a width is in markdown.** CommonMark has no width. `<img width>` is out — ADR-0005 says
  raw HTML is never rendered. That leaves a convention: a query on the src (`![](/api/images/7?w=600)`)
  or the title slot (`![](… "=600x")`). Both are ours to invent, so pick the one another tool
  could still read as an ordinary image.
- **What an agent sees.** The planner reads and writes these bodies through `goblin`. Whatever the
  src becomes, an agent has to be able to leave it alone without corrupting it.
- **Orphans.** Deleting the last reference to an image leaves the bytes behind. Either accept that
  (and let `goblin trash purge` sweep) or reference-count, but say which.

## Sketch of the work

- [ ] Storage decided above, with the schema and the endpoint if there is one
- [ ] `Image` node in the block configuration only, with `parseMarkdown`/`renderMarkdown` so the
      canonical-form test still holds: `serialize(parse(x))` is a fixed point over a fixture that
      includes an image with and without a width
- [ ] Paste and drop of an image file; the existing `handlePaste` sends plain text to the markdown
      parser and must keep doing so, so this is the file branch it does not have yet
- [ ] Drag-to-size, keyboard-reachable (a width field on the mode line's right slot is the
      established pattern — see the code fence's language)
- [ ] A size cap and a refused-with-a-sentence path for something too big, per DESIGN.md Components
- [ ] `goblin backup` still produces one restorable copy of everything
- [ ] Browser smoke: paste an image, size it, reload, see it at that size
