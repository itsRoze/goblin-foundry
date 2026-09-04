# What the keyboard cannot reach, and what it says when it does

**Found:** the close-out of issue 10 (2026-09-04), by `/impeccable critique` on the board and the Ticket view.

Issue 10 gave the focused tile and the Cursor `aria-current`, so the two states a key moves are no longer invisible to a screen reader. Four findings behind that were left for a slice that owns them:

- **Bare single-character shortcuts have no off switch.** `c f v e r a s d j k h l` bind on `window` with no modifier. WCAG 2.1 SC 2.1.4 (Character Key Shortcuts, Level A) asks that such keys be turnable off, remappable, or active only on focus. `isTyping` silences them inside a field, which is not the same thing — voice input anywhere else still fires transitions. Predates issue 10 (issues 02–06 bound most of them); the fix is a setting, so it belongs with `/settings`.
- **`Tab` and `j/k` are two keyboard models wearing one colour.** DOM focus paints a `--gf-system` `:focus-visible` ring; the Cursor paints a `--gf-system` inset. A user who Tabs to a card reasonably expects `⏎` to follow the ring. Either the colour's meanings get written down in Colors, or the Cursor *becomes* DOM focus (roving `tabIndex`), which would collapse the two and make `aria-current` unnecessary. The second is the better answer and is a real refactor of `desk.tsx`.
- **The `blocks` direction has no key.** `d` opens the `blocked by` picker; its peer opens only by mouse, on a tile deliberately built as two equal ends of one fact (ADR-0009).
- **`⌘6` is documented and unreachable.** DESIGN.md Interaction says `⌘1–6`; no S1 page has six tiles. Harmless, but the ceiling is a claim rather than a fact.

Related, and squarely issue 11's: at phone width every tile header still spends its right half on keys that cannot be pressed. Issue 10's decisions list "touch buttons for keyboard-only actions" as issue 11's, so the hint strip's small-screen behaviour goes with them rather than being invented here.
