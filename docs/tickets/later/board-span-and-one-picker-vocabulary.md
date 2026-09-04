# later: two structural findings from issue 06's close-out

**What to build:** Two separate decisions the board's filter bar raised and 06 deliberately did not take.
Each is a change to a rule DESIGN.md already states, so neither is a polish edit.

**Blocked by:** 06. Raised by its `/impeccable critique` (`.impeccable/critique/2026-09-04T01-39-50Z__web-src-pages-board-tsx.md`, 24/40).

**Status:** needs grilling

## 1. The create row and the filter bar answer the same question twice

`c` on the board opens a one-row form whose whole content is "the four things a Filter can name, plus
a title": app, project, status, `simple`. Forty pixels above it, the filter bar answers app, project
and status with a bespoke chip and a picker popover. The row uses native `<select>`s instead, because
that is what every other form in the GUI uses (`InlineForm`, the Ticket view's `about` tile), and
diverging in one row would have been new drift rather than less.

The critique's reading is that the row should *be* the filter bar with a title in front of it —
`ChipButton`, `Popover`, `SearchRows` and `CheckRows` exported from `web/src/filters.tsx` and reused.
That would give the board one vocabulary instead of two, and it would take `↑↓` back: inside a native
select those keys change a value, while two rows above they move a cursor.

The cost is that it splits the GUI's form idiom in half — one screen's create form would stop looking
like every other screen's. The honest version of this ticket is therefore about **every** select in
the GUI, not only the board's three, and that is a house-style decision, not a board decision.

## 2. `is-span` was written for eight columns, and the column count is now variable

DESIGN.md Components ("Kanban column width") gives the board `is-span` because "eight statuses need the
room", and caps a column at 280px. Issue 06 made the number of columns a Filter, so `?status=ready,building`
draws two 280px columns across the whole desk and leaves roughly 900px of empty tile beside them.

Options, none of them free: drop `is-span` below some column count (the tile then moves and resizes as
you check a box, which is worse); let columns grow past 280px when there are few (the cap exists precisely
to stop a card becoming a 400px slab); or accept the space as the honest cost of a board that spans the
desk. The last is what S1 ships. Revisit with a real answer, and amend the Components note either way.

## Also raised, and deliberately not fixed in 06

- **`e2e/writing.e2e.ts` flakes about one run in three**, and it is not issue 06's: the same tests fail
  on `bf78467` with `web/src` and `e2e` checked out at baseline. A different caret test fails each time
  (`:199`, `:221`, `:384`), which is the async-`selectionchange` class of problem `docs/LESSONS.md`
  already records twice. It wants its own pass: place the caret and assert with a retrying matcher rather
  than reading the DOM once.
- **`kbd` on `--gf-raised` measures 4.44:1**, just short of the 4.5:1 the text-safe rule asks for. This
  is not issue 06's: `--gf-mute` on `--gf-raised` is every tile header in the GUI. Fixing it means moving
  `--gf-mute` in `design/tokens.css`, which touches every screen and wants its own before-and-after.
