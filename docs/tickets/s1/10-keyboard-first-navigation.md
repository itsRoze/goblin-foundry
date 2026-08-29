# 10: Keyboard-first navigation

**What to build:** Linear-style keys everywhere per DESIGN.md §8: `j/k` move selection in rows and cards, `⏎` open, `n` new ticket, `a` approve, `d` add dependency, `s` status (transition picker limited to the table's allowed edges), `esc` back, `⌘K` command palette (tickets by key/title, transitions, navigation), `⌘1–6` focus a tile. Every tile header shows its keys; one tile is focused (border in `--gf-system`). Keys always do exactly what the equivalent drag or button does.

**Blocked by:** 05 (Dependencies and the ready frontier)

**Status:** ready-for-agent

- [ ] Selection model with `j/k/⏎/esc` on board and views; focused tile styling per DESIGN.md §2
- [ ] `a`, `s`, `d`, `n` wired to the same API calls as the GUI actions, with the same refusals
- [ ] `⌘K` palette: jump to ticket, run an allowed transition, go to app/project/board
- [ ] Tile headers list their keys in `<kbd>`
- [ ] Browser smoke: `n` creates a ticket, `j` selects it, `⏎` opens it, `esc` returns
