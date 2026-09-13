# The command palette as a bar, not a panel

**Found:** the close-out of issue 10 (2026-09-04), by `/impeccable critique` on the board.

The palette's parts are the house's own — candidate rows in the Ticket picker's shape, mono caps group labels, real status chips, the tile-header key strip at its foot, no backdrop and no dimming. Its *silhouette* is not: a 520px rectangle centred with `left: 50%; translateX(-50%)` over the desk is Raycast and Linear geometry, and DESIGN.md calls the thing "the dmenu of this window manager", which is a **bar** — full width, one bar-height strip against a screen edge, candidates in the same column grid the page already uses.

The gap has a measurable cost, which is why this is written down rather than filed as taste: the panel occludes three kanban columns at laptop width and, at phone width, the tile header, the filter bar and the first two cards. Issue 10 answered the worst of it by naming the subject in the `actions` group label, so what `trash` and `cancel` will act on is at least on screen — but "the screen behind it is still the screen you are acting on" is an argument the current geometry does not earn.

**What to do:** try the bar. A full-width strip below the app bar occludes one row instead of five columns, and its candidates can run in the desk's own grid. Judge it against the same two screens (`/`, `/tickets/:key`) at 1440 and 390 before adopting it, and update Components' **Command palette** entry either way.
