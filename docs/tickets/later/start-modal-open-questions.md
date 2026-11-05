# later: what the Start modal's close-out left open

**What to build:** Decisions the `start-ticket-into-worktree` close-out raised and left, because each changes a flow or a rule rather than polishing one.

**Blocked by:** nothing. Raised by its `/impeccable critique` of the board (27/40).

**Status:** needs grilling

## 1. A tapped Start at phone width ends off screen

`copy folder` takes the focus after a Start, and a key's press brings the line into view. A tap scrolls nothing (DESIGN.md Refusal and confirm), so at 390px the card has moved to `building` and the line that carries the folder sits below the fold, with nothing on screen to say a Start finished. Either the house rule gets an exception for a line that follows a closed modal, since the finger is no longer over anything it could land on by accident, or the line goes somewhere the operator is looking.

## 2. At the `none` terminal step, is the line a failure report?

Story 50 says Start "shows me the folder". With `none` chosen deliberately, `the terminal step is none, so no terminal was opened` is the last thing every Start says, and it reads as an apology for a setting. It could read as the result: the folder, with no reason in front of it.

## 3. Why does no Checkout send you away?

`go to <App>` leaves the Ticket, and the operator has to remember to come back and Start again. One path field in the panel, validated by the API the way the App view's is, would keep them there. It would also make the modal write to an App, which it does not do today.

## 4. Is it a dmenu or a tile?

The palette says it is not a dialog, and this wears its clothes while being one. If it holds the focus, it could wear a focused tile's `--gf-system` border and a tile head.
