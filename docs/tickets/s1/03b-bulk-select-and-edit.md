# 03b: Multi-select and bulk edit on the kanban

**What to build:** Linear-style selection on the board — `x` or shift-click toggles a card into the selection, `esc` clears — followed by bulk actions on the selection: trash, move to app/project, and status transition (every card must have the same allowed edge, otherwise the action is refused with the table's hint). A selection survives the 5 s poll (keyed by ticket id, dropped for cards that leave the board).

**Blocked by:** 04 (Lifecycle — transition table, intent endpoints, drag-and-drop)

**Status:** stub (grilled 2026-08-28 alongside 03)

**Decisions:** No bulk endpoint — the GUI issues N single requests (one event per ticket falls out for free, partial failure is per-card, `goblin` stays one-subcommand-per-endpoint). Reconsider only if a 50-card selection is visibly slow.

**Touch coverage (agreed while grilling 11, 2026-09-16):** This ticket owns touch selection and bulk-action controls as part of shipping bulk workflows. Selecting, deselecting, clearing the Selection, and invoking every bulk action must work without a keyboard at every width. Follow issue 11's responsive control conventions; the exact selection gesture remains to be designed here. Issue 11 does not absorb or wait for this feature.

- [ ] Selection model and keys; selection count in the bar
- [ ] Bulk trash, bulk move (app/project `<select>`), bulk transition via 04's intents
- [ ] Per-card failure shown inline; the rest succeed
- [ ] Selection and every bulk action are usable by touch at every width, including deselecting and clearing the Selection
- [ ] Browser smoke: select three cards, move them to a project, see the meta line change
