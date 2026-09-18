# 03b: Multi-select and bulk edit on the kanban

**Status:** done (implemented 2026-09-17 on branch `03b-bulk-select-and-edit`)

**Depends on:** 04 (Lifecycle — transition table, intent endpoints, drag-and-drop). Integrates with 10's keyboard/palette behavior and follows 11's responsive controls; 11 does not wait for this feature.

**Spec agreed:** 2026-09-16, through grilling this ticket.

## Problem Statement

Moving, approving, or trashing several Tickets currently requires repeating the same action on each Ticket. People need familiar keyboard and pointer selection, equivalent touch controls, and confidence that a bulk action changes the entire chosen set or changes nothing. Selection must remain understandable as the board polls, filters change, columns fold, and people visit Ticket views.

## Solution

Introduce a Selection independent of the Cursor, with card checkboxes, individual keyboard toggles, range selection, and Select all. Show its count and provide bulk transitions, App/Project moves, and trash. Every bulk action is a single atomic server operation: validate the complete set, then commit all Ticket changes and their history together. On refusal, explain which Tickets prevent the action and preserve Selection; on success, clear it.

## User Stories

1. As a board user, I want a checkbox on every card at every width, so that I can select and deselect Tickets without opening them.
2. As a touch user, I want tapping a card to keep opening it, so that selection controls do not disrupt navigation or require long-press.
3. As a keyboard user, I want `x` to toggle the Ticket under the Cursor, so that I can gather nonconsecutive Tickets while navigating.
4. As a pointer user, I want shift-click to select an inclusive range, so that gathering consecutive Tickets is quick.
5. As a keyboard user, I want Shift+Up/Down to extend or contract a range, so that I can adjust it without a mouse.
6. As a board user, I want ranges to follow column lifecycle order and card order, so that their boundaries are predictable across columns.
7. As a board user, I want the most recent individual selection to establish the range anchor, so that a range starts where I last selected a Ticket.
8. As a board user, I want shift-click without an anchor to select that card and establish an anchor, so that the first range gesture has a clear result.
9. As a board user, I want range changes to preserve independently selected Tickets outside the range, so that extending or contracting a range does not erase other choices.
10. As a board user, I want new ranges to skip folded columns while preserving Tickets already selected there, so that folding does not silently change my existing Selection.
11. As a keyboard user, I want Cmd/Ctrl+A to select the current filtered board, including folded columns, so that I can act on the complete filtered set.
12. As a touch user, I want visible Select all and Clear selection controls, so that these operations never require a keyboard.
13. As a person editing text, I want board shortcuts to leave text-field behavior intact, so that typing and selecting text remain normal.
14. As a board user, I want an accurate Selection count distinct from the Cursor, so that I know which set a bulk action targets.
15. As a board user, I want Selection to survive polling, scrolling, folding, orientation changes, and opening a Ticket and returning, so that ordinary navigation does not lose my work.
16. As a board user, I want Tickets leaving the current Filter to leave Selection, so that bulk actions do not target Tickets outside my board.
17. As a board user, I want a full reload to clear Selection, so that an old set is not silently restored.
18. As a keyboard user, I want Escape to close the topmost open control, then clear Selection, then clear Cursor on a subsequent press, so that dismissal is predictable.
19. As a board user, I want `a`, `s`, and palette actions to target Selection when it exists and display its count, so that the Cursor cannot silently redirect a bulk action.
20. As a board user, I want only supported bulk actions offered for Selection, so that Simple and dependency actions cannot accidentally affect a different Ticket.
21. As a keyboard user, I want `d` to explain that dependencies require a single Ticket while Selection is active, so that its behavior is clear.
22. As a Ticket user, I want card menus and the open Ticket view to retain their own Ticket target, so that Selection does not change their meaning.
23. As a board user, I want to apply the same named Transition across compatible source Statuses, so that eligible todo and planning Tickets can be approved together.
24. As a board user, I want incompatible Transitions refused for the entire Selection with the table's reasons, so that different intents are never conflated merely because they share a destination.
25. As a board user, I want any missing App, required Design, permission, or other guard to refuse the whole action, so that I never receive a partially updated set.
26. As a board user, I want moving to a Project to adopt its App and moving to an App to clear Project membership, so that bulk moves follow existing membership rules.
27. As a board user, I want Remove from Project to keep each Ticket's App and Remove App and Project to clear both, so that I can reorganize Tickets explicitly.
28. As a board user, I want one invalid destination or membership guard to refuse the whole move, so that all selected Tickets remain together on failure.
29. As a board user, I want one confirmation before starting Tickets with unfinished blockers, listing those Tickets and their blockers, so that I can make an informed decision for the whole batch.
30. As a board user, I want bulk trash confirmation to name the complete selected count, including folded Tickets, so that I understand what will be Trashed.
31. As a board user, I want cancelling either confirmation to send no mutation and preserve Selection, so that reconsidering an action is harmless.
32. As a board user, I want confirmation tied to the exact Ticket set and refreshed when relevant eligibility or blockers change, so that I never approve an outdated action.
33. As a board user, I want the submitted set and action frozen while pending, with further mutations on those Tickets disabled, so that I cannot accidentally overlap conflicting actions.
34. As a board user, I want pending feedback such as “Approving 10 Tickets…” and continued execution across in-app navigation, so that I can navigate without losing the operation.
35. As a board user, I want success to clear Selection and a definite refusal to say “Nothing changed” with Ticket keys and reasons, so that the result is actionable.
36. As a board user, I want a lost response to say “Couldn't confirm the outcome,” refresh the board, and avoid automatic retry, so that an uncertain result is not presented as a definite failure.
37. As a person reviewing history, I want each changed Ticket's history committed with the Ticket change, so that an unsuccessful batch leaves neither partial changes nor misleading events.
38. As a touch user, I want every bulk action, confirmation, cancellation, and selection control usable at every width, so that mobile workflows are complete.

## Implementation Decisions

- **Selection ownership.** Keep Selection separate from Cursor and identify members by stable Ticket id. Filter membership determines the available set; viewport visibility and folding do not. Reconcile against polling and Filter changes, preserve it through a Ticket round-trip, and clear it on full reload. Pending submission retains its exact target snapshot even if the displayed board changes.
- **Selection controls.** Checkboxes are explicit at every width. `x` toggles the Cursor Ticket; shift-click selects a range; Shift+Up/Down extends or contracts it. Ranges use lifecycle column order and top-to-bottom card order, include both endpoints, skip folded columns, and preserve independently selected Tickets. The most recent individual selection establishes the anchor; shift-click without one selects the clicked card and establishes it. Cmd/Ctrl+A and a visible Select all control include every Ticket in the current Filter, including folded columns. Input fields retain native keyboard behavior.
- **Clearing and presentation.** Show the selected count in the bar and distinguish Selection from the existing Cursor mark. Provide Clear selection. Escape closes the topmost control before clearing Selection, then Cursor. Selecting a checkbox does not open a Ticket or require the existing long-press drag gesture.
- **Action targeting.** Integrate Selection with board keyboard actions, the command palette, and touch bulk controls. While Selection exists, the board offers transitions, move, and trash; Simple and dependency palette actions are hidden and `d` explains the single-Ticket requirement. Card menus and open Ticket views keep their own target. The pending mutation lock still applies to submitted Tickets wherever they are viewed.
- **Transition semantics.** Every selected Ticket must support the same named intent under the shared transition table. Source Statuses may differ; a common destination is insufficient. Client structural preflight can refuse early, but the server revalidates all members and guards authoritatively. Actor ownership remains unchanged, including the existing restriction on agent Transitions.
- **Membership semantics.** Selecting a Project adopts its App; selecting an App clears Project membership. Remove from Project preserves each Ticket's App; Remove App and Project clears both. Reuse existing destination availability and Approve Guard rules. Any invalid member refuses the entire move.
- **Atomic API.** Replace N independent requests with batch operations for the supported actions, receiving the explicit submitted Ticket set and action/target. Transitions remain named intents; batch access does not create a generic Status-edit bypass. Validate all live members, actor authority, guards, and destinations and commit all Ticket changes and individual history records in one transaction. A missing or Trashed member, validation refusal, or write failure changes nothing. Return Ticket-specific reasons through the existing problem-response conventions. Exact endpoint spelling is an implementation detail.
- **Atomic storage boundary.** ADR-0010 requires a verified atomic operation behind the existing database seam, superseding ADR-0001's sequential-statement approach for bulk actions. Keep driver-specific behavior behind that seam, and do not assume an async wrapper or compensating requests provide atomicity. Preserve the existing lifecycle, membership, and event semantics. Prove that a failure after writes begin rolls back both Tickets and history.
- **Confirmations.** Bulk trash asks once with the full selected count. Bulk start asks once when any selected Ticket has unfinished blockers, listing affected Tickets and blockers and holding the entire batch until confirmed. Cancel sends no mutation. Confirmation is bound to the exact set: Selection changes dismiss it; relevant eligibility or blocker changes require a fresh check and, when applicable, fresh confirmation. Unrelated title edits do not. The server validates before committing.
- **Execution lifecycle.** Freeze the submitted set/action and disable selection changes and further mutations on those Tickets while pending. Keep in-app navigation available and execution alive across it. Show an action and count, not per-Ticket completion progress. Reloading does not undo an already submitted operation.
- **Results.** Success clears Selection. A definite refusal preserves it subject to current Filter membership, says “Nothing changed,” and identifies offending Ticket keys and reasons. A lost response is an unknown outcome: say “Couldn't confirm the outcome,” refresh the board, and never automatically retry or claim no changes occurred. Client presentation and cache reconciliation must respect the single atomic result.

## Testing Decisions

The existing real-SQLite API harness and Playwright browser suite are the agreed test seams, with focused selection-model tests only where range behavior needs additional coverage (confirmed 2026-09-16).

- Test observable behavior through existing public seams. Prefer requests, persisted Ticket state, returned history, and visible browser behavior over component internals, SQL shape, or implementation call counts.
- **Primary correctness seam: existing in-process HTTP API harness with a fresh real SQLite database.** Follow the lifecycle, Ticket membership, actor, and history tests, which create fixtures through legal API operations and inspect results through reads and event endpoints. Cover successful mixed-source Transitions, moves, removals, and trash; all-member refusal for invalid edges, App/Design guards, actor authority, destinations, and missing or Trashed members; and unchanged Ticket/history state after refusal.
- **Rollback evidence.** Use a controlled write/event failure after mutation work begins and assert through the API that every Ticket and history record remains unchanged. Validation-only tests cannot prove atomicity. Any necessary failure-injection mechanism stays at the storage boundary rather than creating another public application interface.
- **Browser integration seam: existing Playwright suite.** Follow the keyboard, palette, transition, Filter, folded-section, and responsive/touch tests. Cover individual and range selection, selected count, Select all and Clear selection, shortcut isolation in inputs, Cursor independence, action targeting, and Selection lifecycle under polling, navigation, Filter changes, folding, orientation changes, and reload.
- **Confirmation and request lifecycle.** Exercise cancellation without mutation, changed Selection, relevant versus unrelated Ticket updates, pending locks and in-app navigation, definite refusal, and lost-response feedback without automatic retry. Verify folded selected Tickets are included in counts and actions.
- **Focused model tests where useful.** Follow the existing Cursor and palette pure-function tests for range anchor behavior, extension/contraction, cross-column order, independently selected Tickets, and folded-column exclusion. Use these to cover meaningful combinations rather than duplicating every browser assertion.
- **End-to-end acceptance.** Select three Tickets, move them to a Project, and verify their metadata changes and Selection clears. Attempt approval with one ineligible member and verify that none change and Selection remains; fix that Ticket and successfully approve the set. Exercise equivalent selection, clearing, all bulk actions, and confirmation flows using touch-only controls in the existing phone/browser configurations.

## Out of Scope

- Partial success, N independent mutations, compensating rollback, or automatic retries for bulk actions.
- Bulk Simple edits, bulk dependency edits, bulk restore, or additional bulk fields beyond the agreed moves, transitions, and trash.
- Changing lifecycle authority, making dependency blockers a new server-side transition guard, or changing the meaning of ship versus close.
- Persisting Selection across full reloads, background-job infrastructure, or a new real-time synchronization system.
- Replacing the established Cursor, card-opening behavior, drag gestures, responsive board layouts, or database technology.

## Further Notes

- [ADR-0010: atomic bulk Ticket actions](../../adr/0010-atomic-bulk-ticket-actions.md) records the architectural trade-off. [ADR-0001](../../adr/0001-sqlite-via-drizzle-single-process.md) now points to that scoped exception. Intent authority, App-following-Project membership, and advisory dependencies continue to follow ADR-0003/0004, ADR-0007, and ADR-0009 respectively.
- [Linear's selection documentation](https://linear.app/docs/select-issues), checked during this discussion, informed the keyboard conventions. It documents individual selection, keyboard ranges, Select all, and Escape; our shift-click range boundaries are explicitly agreed product behavior.
- The ticket itself is the requested publication destination.

## As built

- **API.** `POST /api/tickets/bulk` with `{ tickets: [keys], action }`, where `action` is `{kind:'transition', name}`, `{kind:'move', to}` (`to` is `{kind:'project'|'app', id}`, `{kind:'no-project'}` or `{kind:'nowhere'}`) or `{kind:'trash'}`. Success is `200 {tickets}`. A refused member is `409 {owner, hint, refusals:[{key, reason}]}` — the refused-intent shape plus the per-Ticket reasons; a bad destination or body is `422 issues`; a write that failed and was rolled back is `500` with `detail` beginning *nothing changed*. At most 500 Tickets per batch. `goblin ticket <transition|trash> <keys…>` sends one batch when given more than one key (one key is the single call, unchanged), and `goblin ticket move <keys…> --project <id|null> | --app <id> | --nowhere` is the new verb for membership.
- **Atomic boundary.** `atomically(db, writes)` in `api/src/db.ts`: a list of built statements run between `BEGIN IMMEDIATE` and `COMMIT` in one synchronous block, each proven to have written exactly one row, each Ticket write pinned to the `updated_at` and status it was judged at, and a move's destination pinned by a no-op write that matches only a live, unarchived App or Project still in the judged App. A pin that matches nothing is `stale`: `409` naming the Ticket, nothing changed. Rollback evidence: `api/test/bulk.test.ts` (trigger-injected faults through the API) and `api/test/db.test.ts` (the seam itself).
- **One judge.** `judgeTransition` in `shared/src/transitions.ts` is what the single-Ticket route, the batch and the board's preflight all ask, so the three cannot drift.
- **Selection.** `web/src/selection.ts` (pure model: `picked` + `ranged` + `anchor`), `web/src/bulk.ts` (pure: shared verbs, preflight, the two questions, what a confirmation is bound to), `web/src/selecting.tsx` (the shell-level owner: Selection, the one action out at a time, the pending lock, the outcome). Deselecting a Ticket clears the anchor; the next range gesture plants a new one.
- **Decisions taken while building.** `⇧↑/⇧↓` (and `J`/`K`) walk the *range order* — off the end of one column into the next — so a cross-column range is reachable from the keyboard, and the Cursor rides the far end. The palette and `s` offer the verbs every selected Ticket shares; `a` on a Selection that does not share `approve` is refused with each Ticket's reason. A start question whose blockers all clear is withdrawn rather than left asking about nothing. Success says *Approved 3 Tickets* for four seconds. Off the board, the shell reports a pending or finished action in a strip under the bar.
- **From the code review.** A question whose blockers change is redrawn from the live members before any yes is given, rather than dismissed and re-opened — no yes ever answers the old text. Only the API's own problem document counts as a definite refusal; a bare `502` from anything in between is an unknown outcome. A card's own blocked-`start` question checks the lock when it goes, not when it was asked. `recordEvent` starts a fresh history row if the edit session it meant to amend has moved on, instead of writing nothing. ADR-0001 gained a third carve-out: the test harness may create triggers in its own database for fault injection.
- **Known, not from this ticket.** Two browser specs in `e2e/writing.e2e.ts` (*backspace against a revealed marker…*, *a run that opens the line…*) fail identically on the commit this branch started from (`3ccefed`), and the first spec in `e2e/z-filters.e2e.ts` (the text filter's `toHaveURL`) fails there too but only some runs — a flake, also not this ticket's.
