# 11: Mobile-first responsive layout and touch controls

**Status:** done (PR #21 merged 2026-09-16, 8f4fe78)

**Blocked by:** 04 (Lifecycle — transition table, intent endpoints, drag-and-drop)

**Design direction:** confirmed through grilling and Impeccable shape, 2026-09-16. This spec supersedes the original phone horizontal-board and phone drag-smoke requirements.

## Problem Statement

The operator can use Goblin Foundry with a keyboard at a desk, but narrow screens and touch expose gaps: horizontal columns make phone triage cumbersome, some actions exist only as keyboard hints, and forms cannot always be completed or cancelled through visible controls. A responsive grid alone does not make the tracker usable without a keyboard.

The operator needs to scan work by Status, open and edit Tickets, and perform the existing workflows on a phone without losing the desktop experience or changing lifecycle rules.

## Solution

Adapt the board automatically to available width. Narrow boards present vertically stacked, independently collapsible Status sections. Wider boards keep horizontal columns and drag-and-drop. Card action menus provide transitions at every width; vertical sections do not support dragging.

Keep each collapsed Status heading and its Ticket count visible. Remember expansion on this device without changing the Filter or shared URL. Initially expand Planning, Ready, Building and Review; collapse Backlog, Todo and Done. A move into a collapsed section updates counts and confirms the destination without opening the section or jumping the page; a Show action reveals the moved Ticket on demand.

Make every implemented S1 workflow reachable and usable by touch while preserving the house style, desktop keyboard behavior, and existing domain rules.

## User Stories

1. As the operator, I want a vertical board in a narrow window, so that I can scan work without sweeping sideways through columns.
2. As the operator, I want horizontal columns when there is room, so that I retain the desktop overview.
3. As the operator, I want layout chosen by available width rather than input type, so that tablets, resized windows and hybrid devices behave consistently.
4. As the operator, I want no horizontal page scrolling, so that navigation and content stay within the screen.
5. As the operator, I want to expand or collapse each Status independently, so that I can focus on relevant work while keeping several sections open.
6. As the operator, I want collapsed headings and counts to remain visible, so that I know what work is out of view.
7. As the operator, I want collapsing to leave my Filter and URL unchanged, so that my saved or shared view still identifies the same Tickets.
8. As the operator, I want Planning, Ready, Building and Review initially expanded, so that ongoing work is immediately visible.
9. As the operator, I want my expansion choices remembered on this device across visits, so that the board retains my preferred presentation.
10. As the operator, I want refreshes and background updates to preserve expansion choices, so that the board does not unexpectedly rearrange itself.
11. As the operator, I want tapping a card to open its Ticket, so that familiar navigation remains intact.
12. As the operator, I want a quiet, easy-to-tap card action menu, so that I can act on that Ticket without a keyboard or oversized visual controls.
13. As the operator, I want a card menu to target its own Ticket, so that actions cannot accidentally apply to a different Cursor or Selection.
14. As the operator, I want vertical-board transitions through the menu, so that moving work does not conflict with page scrolling.
15. As the operator, I want the same permitted transitions and Approve Guard everywhere, so that touch cannot bypass lifecycle rules.
16. As the operator, I want refusals and blocked-start confirmation to remain visible and actionable, so that I understand why a move did not proceed.
17. As the operator, I want moves into collapsed sections to preserve my presentation and scroll position, so that triage is not interrupted by a jump.
18. As the operator, I want a successful move to name the Ticket and destination and offer Show, so that I can find the moved Ticket when I choose.
19. As the operator, I want horizontal-board drag to work with touch, so that I can use it on a roomy touchscreen.
20. As the operator, I want ordinary swipes to scroll and a deliberate long-press to start horizontal-board dragging, so that scrolling does not accidentally change Status.
21. As the operator, I want edge scrolling during horizontal-board drag, so that offscreen destinations are reachable.
22. As the operator, I want releasing outside a destination to cancel a drag, so that an abandoned gesture does not mutate a Ticket.
23. As the operator, I want visible create, submit and cancel controls, so that I can complete forms without keyboard shortcuts.
24. As the operator, I want filters, View options, search and navigation reachable by touch, so that I can find the work and screen I need.
25. As the operator, I want to edit descriptions and Designs with touch, so that I can maintain intent away from my keyboard.
26. As the operator, I want editor controls and form actions reachable with the software keyboard open, so that entering text does not hide the way to finish.
27. As the operator, I want dependencies, entity management, Settings and Trash usable at narrow widths, so that phone access is not limited to the board.
28. As the operator, I want menus and pickers to fit the visible screen and provide a touch dismissal path, so that I cannot become trapped in an overlay.
29. As the operator, I want keyboard navigation and visible focus to keep working in either layout, so that attaching a keyboard does not change which actions are available.
30. As the operator, I want the same supported experience on iOS Safari and Android Chrome, so that mobile browser choice does not determine whether essential workflows work.

## Implementation Decisions

### Confirmed behavior

- Preserve the existing house style and desktop desk tiers: one column below 1440px, two at 1440px, three at 1920px, four at 2560px. The board's orientation breakpoint is a separate choice; do not infer it from the desk grid.
- Switch board orientation automatically by available width. No manual layout override, device classification or touch detection chooses the orientation.
- Vertical Status sections expand independently. Headings and counts remain when collapsed. Counts describe Tickets in the current Filter, not only expanded cards. Preserve Lifecycle order; the Filter still determines which Status sections appear, including whether Cancelled appears.
- Use the agreed first-visit expansion defaults and remember later choices per device across visits. Expansion is presentation state, separate from the Filter, shared URL, Cursor and Selection. Do not turn a collapsed section into a status-filter exclusion.
- Narrow content tiles use page scrolling. Horizontal-board scrolling remains contained inside its tile; the page never scrolls horizontally. The old requirement for a bounded horizontal phone board is superseded.
- Preserve card tap-to-open. A distinct per-card action menu uses existing actions and targets that card without changing Cursor or Selection. Reduce the visual weight of the three-dot control; the prototype's large boxed button was rejected. Its visible mark need not fill its interactive area.
- Use the existing lifecycle table, transition intents, mutation handling and refusal behavior. Do not create a second authority for menu or touch transitions. Blocked-start confirmation and Approve Guard still apply.
- No drag between vertical sections. Horizontal boards retain drag, including deliberate long-press touch initiation, ordinary swipe scrolling, edge scrolling to offscreen columns, cancellation outside a destination, and the existing refusal/rollback behavior. Drop position does not introduce ordering.
- A successful move into a collapsed section keeps it collapsed and preserves the reading position, updates counts, and confirms the Ticket and destination with a Show action. Show reveals the Ticket on explicit request; success alone must not expand or scroll to it.
- Make action controls available at every width. Keyboard hints supplement controls; they are not substitutes for buttons. Scope includes completing and cancelling create forms, board View options, navigation, editors, dependencies, App/Project management, Settings and Trash.
- Preserve live document editing and autosave. Improving touch controls must not introduce document save/cancel semantics. Create forms remain explicit-submit.
- Expected changes are within the responsive shell and tile layout, board presentation and action targeting, touch drag integration, form/editor controls, overlays and browser verification. No database schema change or new API contract is needed.

### Bounded implementation choices

These details were not separately approved during the interview. Resolve them through focused prototype verification against the confirmed behavior, record the resulting rules in the house style, and do not present the prototype defaults as prior user decisions:

- **Orientation breakpoint:** choose where actual columns and controls become cramped. Verify narrow phone and tablet windows, roomy desktop windows, and both sides of the selected breakpoint.
- **Control geometry:** choose adequate hit areas without restoring heavy button chrome or causing overlapping targets. The prototype used 44px as a candidate, not an approved universal size.
- **Menus and software keyboard:** choose placement and scrolling that keep the focused input, actions and dismissal reachable in the visible viewport. Top, anchored and bottom placements were explored; none was selected.
- **Editor completion and link editing:** provide touch equivalents for the existing finish and cancellation operations. Clickable Done and link Apply/Cancel were proposed, not approved labels or layout. Preserve the distinction between cancelling a link edit and cancelling an autosaved document.
- **Refusal and confirmation placement:** keep the affected Ticket identifiable and the message/action visible after menu closure or scrolling. Board-level placement was proposed but not selected. Do not hide an outstanding confirmation in a collapsed or offscreen section.
- **Expansion edge cases:** choose a default for Cancelled when explicitly filtered in, and define how Show-induced expansion is remembered. Keep stored choices stable across polling, filtering and orientation changes.
- **Focus and scrolling:** define keyboard traversal of collapsed sections and vertical scrolling using the existing Focused tile and Cursor model. A hidden Cursor must not leave the operator acting unknowingly on an invisible Ticket. Avoid nested scroll regions that make vertical triage awkward; account for necessary browser scroll clamping after content shrinks.
- **Filtered-out destinations:** Show must not silently change the Filter. If a moved Ticket no longer belongs to the current board, provide a truthful way to open it without pretending it is visible in a section.

## Testing Decisions

- Prefer one primary seam for this UI change: the existing Playwright browser smoke suite against the built GUI and scratch database. Test observable outcomes, not component internals, CSS class choices, storage key names or library callbacks.
- Reuse existing responsive, lifecycle, keyboard, form and editor browser tests as prior art. Existing HTTP/API tests remain the authority for exhaustive lifecycle edges and guards; do not duplicate that matrix in browsers or introduce a new API seam.
- Exercise the shell, board, Ticket view, App and Project details and lists, Settings and Trash at 390, 768, 1440, 1920 and 2560px. Preserve useful existing width coverage. Check horizontal page overflow, usable content and desktop tile readability. Update the stale phone assertion that specifically requires horizontal kanban scrolling.
- Verify vertical sections, independent expansion, counts, first-visit defaults and persistence across reload and revisit. Assert Filter/URL stability, preservation across background updates and orientation changes, and a clean device's default state.
- Drive card menus through visible controls. Prove the correct Ticket changes without changing an unrelated Cursor, and verify an accepted transition, an Approve Guard refusal and blocked-start confirmation.
- Move a Ticket into a collapsed section: confirm counts, retained collapse and reading position, visible success feedback, and Show revealing the Ticket. Include a destination excluded by the Filter.
- Retain mouse-drag lifecycle smoke tests on a horizontal viewport. Add real touch-input gesture coverage for long-press lift, scrolling, edge reach, accepted/refused drops and release outside a destination. A mouse drag in a phone-sized viewport is not evidence of touch drag.
- Run narrow touch interactions in Chromium and WebKit. Cover horizontal touch drag at a width that actually renders horizontal columns; the phone smoke now tests vertical sections and action menus rather than phone dragging.
- Cover representative touch-only workflows end to end: create/submit/cancel, open a Ticket, edit content, manage a dependency, navigate to Settings/Trash, and dismiss menus without Escape. Inspect long titles, populated and empty sections, long Designs, menu overflow and a software keyboard obscuring part of the viewport.
- Keep desktop keyboard regression coverage, adding the observable collapsed-section focus behavior chosen during implementation. Use existing checks for formatting, typing and build correctness.
- Target iOS Safari and Android Chrome. Report emulated Chromium/WebKit results separately from actual device/browser verification; software-keyboard and long-press behavior must not be claimed verified on devices solely from emulation. Record any unavailable device checks explicitly.

## Out of Scope

- Bulk selection and bulk actions: ticket 03b owns their touch controls and does not block this work.
- Vertical-board drag, card reordering, Claim Order, a manual board-layout switch or a new mobile-only product workflow.
- Changes to lifecycle authority, allowed transitions, guards, Filter semantics, shared URL semantics, API contracts or persistence of domain records.
- Redesigning the visual identity, broad accessibility/keyboard refactoring unrelated to responsive controls, deployment, authentication, sync or new S1 features.
- Promoting throwaway prototype code directly into production.

## Further Notes

The confirmed shape is the source for this spec; prototype-only details remain implementation choices as explicitly listed above. The comparison prototype is `work/mobile-controls-browser.html`. It uses local sample state and simulated keyboard/feedback, has not been visually verified through browser automation, and is not evidence of production touch behavior.

Update DESIGN.md to describe the implemented vertical-board rule, horizontal touch drag, controls and responsive breakpoint. Its existing small-layout rule and removal of Mobile from the unspecified list already exist; reconcile them rather than treating them as new work. Do not introduce glossary terms or ADRs solely for responsive mechanics. An ADR is warranted only if implementation reveals a meaningful, hard-to-reverse trade-off.

The project tracks this work in this ticket file. No external issue publication is requested. Existing browser/API testing seams were accepted during the interview; this spec retains them.

## As built (2026-09-16)

The bounded choices above, resolved and recorded in DESIGN.md (Layout, Components *Stacked board* · *Card menu* · *Touch targets*, Interaction *As built, issue 11*):

- **Orientation breakpoint:** the board's own tile body under 640px stacks (a window under about 700px). 390 and 600 stack; 680 stacks and 720 does not; 768 keeps the kanban. Decided by a `ResizeObserver` on the board, never by pointer type.
- **Control geometry:** 32px is the floor for a finger's target (the card's `⋯`, menu rows at 34px, section heads at 36px); the visible mark need not fill it. Hints that are also controls keep the hint's clothes. 44px was not adopted.
- **Menus and the software keyboard:** the card menu hangs from the card's right edge and flips above when the visual viewport has no room below; the viewport meta asks the keyboard to resize the page (`interactive-widget=resizes-content`, Android Chrome; iOS Safari ignores it and overlays instead, where the page still scrolls under the keyboard). Nothing is docked to the bottom of the window.
- **Editor completion and link editing:** `done` on the mode line where the `⌘⏎ done` hint was; `apply` and `cancel` beside the URL field. `cancel` cancels the link and puts the caret back; the document has no cancel (issue 07 stands).
- **Refusal and confirmation placement:** under the card the menu or key was about; under the section head when that section is folded; under the column for a drop, as before.
- **Expansion edge cases:** `cancelled` folds by default; `show` records the opening as a tap on the head would. Stored per status only when chosen, so defaults can move later without touching a device's choices.
- **Focus and scrolling:** the stacked board is one Cursor column of the open sections in reading order; folding the section under the Cursor drops it. No nested scroll region.
- **Filtered-out destinations:** `GF-n moved to <status>, which this filter leaves off · open`, where `open` goes to the Ticket. The Filter is never changed to show it.
- **Touch drag:** pointer events on the kanban only — a still 350ms hold lifts, more than 10px before that is a scroll, 48px from the tile's edge scrolls it, release off a column drops nothing. Ends in the same `drop` as the mouse (`web/src/touch-drag.ts`).

**Close-out polish (`ui-closeout`, board 28/40 · Ticket view 28/40 · Project view 29/40; deterministic scan clean).** Under `pointer: coarse` every shared control grows to 32px and hints that are not controls fold away; the card menu puts `close` last among the arrows and owns the keys while open; a move notice clears on a press anywhere else; the mode line at phone width is one sticky row that keeps `done` and the save word on screen with the keyboard up, and an inline field reserves its seat so the line never lands on `archive`/`trash`; the state tile's `a approve` and `d deps` are controls as the board's are; the Ticket view's selects and the bar's `⌘K` take the house font. Left and written down: `docs/tickets/later/project-view-phone-order.md` (the Project view's tile order and the graph's scroll box on a phone, `press c`/`press e` copy, refusals that never clear, `save` on an empty title); the `is-danger` contrast is `contrast-on-every-surface.md` from issue 10.

**Verification.** Emulated, in `bun run test:e2e`: Chromium desktop at 375/390/600/768/900/1200/1440/1920/2560/3440 on every route (`e2e/z-responsive.e2e.ts`); the stacked board, expansion memory, menus, refusals, the blocked-start question, moves into folded and filtered-out statuses, and keyboard traversal (`e2e/z-sections.e2e.ts`); tap-only workflows at phone size in Chromium (Pixel 5) **and** WebKit (iPhone 13) (`e2e/touch-phone.e2e.ts`); the long-press drag with Chromium's own touch input layer at 900px, including swipe-to-scroll, edge reach, refused drops and release off a column (`e2e/touch-drag.e2e.ts`). WebKit's automation has no touch-gesture input layer, so the long-press drag is **not** verified in WebKit. **Not verified on a device:** iOS Safari and Android Chrome on real hardware — the software keyboard's behaviour, the real long-press timing against the OS's own callout, and haptics were not available in this session and are not claimed. The WebKit run did catch one real iOS bug: `ProblemError.line` was shadowed by WebKit's own `Error.line`, so every refusal on iOS read as a source line number (`docs/LESSONS.md`).

**Known, pre-existing:** two caret tests in `e2e/writing.e2e.ts` (`backspace against a revealed marker…`, `a run that opens the line…`) fail identically on `main` with the Chromium build Playwright 1.62 installs; not touched here.
