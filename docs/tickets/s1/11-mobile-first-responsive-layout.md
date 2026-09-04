# 11: Mobile-first responsive layout and touch drag

**What to build:** The GUI is laid out mobile-first: a single-column stack of tiles as the base, the 2×2 tile grid at laptop width and 3×2 at wide width (DESIGN.md Layout). The kanban scrolls horizontally inside its tile; the page never scrolls horizontally. Drag-and-drop works on touch. Actions that are keyboard-only on desktop are available as buttons in tile headers on touch devices. Amend DESIGN.md: Layout gains the small-layout rule, Deliberately not specified drops "Mobile" from the unspecified list.

**Blocked by:** 04 (Lifecycle — transition table, intent endpoints, drag-and-drop)

**Status:** ready-for-agent

- [ ] Layout verified at 390, 768, 1440 and 2560 px widths; no horizontal page scroll at any of them
- [ ] Touch drag between columns performs transitions with the same refusals
- [ ] Tile-header action buttons on touch/narrow layouts
- [ ] DESIGN.md Layout and Deliberately not specified updated
- [ ] Playwright runs the drag smoke at a phone viewport with touch emulation
