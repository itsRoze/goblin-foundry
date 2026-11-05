# later: what the Start modal's close-out left open

**What to build:** Decisions the `start-ticket-into-worktree` close-out raised and left, because each changes a flow or a rule rather than polishing one.

**Blocked by:** nothing. Raised by its `/impeccable critique` of the board (27/40) and of the Ticket view (27/40) and of the App view (28/40).

**Status:** needs grilling

## 1. A tapped Start at phone width ends off screen

`copy folder` takes the focus after a Start, and a key's press brings the line into view. A tap scrolls nothing (DESIGN.md Refusal and confirm), so at 390px the card has moved to `building` and the line that carries the folder sits below the fold, with nothing on screen to say a Start finished. Either the house rule gets an exception for a line that follows a closed modal, since the finger is no longer over anything it could land on by accident, or the line goes somewhere the operator is looking.

## 2. At the `none` terminal step, is the line a failure report?

Story 50 says Start "shows me the folder". With `none` chosen deliberately, `the terminal step is none, so no terminal was opened` is the last thing every Start says, and it reads as an apology for a setting. It could read as the result: the folder, with no reason in front of it.

## 3. Why does no Checkout send you away?

`go to <App>` leaves the Ticket, and the operator has to remember to come back and Start again. One path field in the panel, validated by the API the way the App view's is, would keep them there. It would also make the modal write to an App, which it does not do today.

## 4. Is it a dmenu or a tile?

The palette says it is not a dialog, and this wears its clothes while being one. If it holds the focus, it could wear a focused tile's `--gf-system` border and a tile head.

## 5. Once a Ticket has a Worktree, what is the Branch Suggestion for?

The close-out labels it `suggested`, but `copy branch` and the palette's `copy branch name` still copy the suggestion, not the branch the Worktree is on. With a Worktree on `spike/feed-parsers`, they give `gf-19-…`, and pasting that into `git checkout` goes somewhere else. The spec placed the Worktree "near the Branch Suggestion", so dropping the row and pointing both copies at `worktree_branch ?? suggestion` is the spec's call to reverse. The Start modal already prefills from the recorded Worktree, so nothing else needs the row.

## 6. A gone folder is still a dead end in the GUI

The refusal now says what to run, but it clears after 4s and sits off screen after `t` at phone width (the late-refusal clause in Refusal and confirm), the tile keeps offering `copy folder` on a dead path, and a Ticket in `review` has no `stop` to go round by. Story 39's answer fits: Open terminal on a gone folder opens the Start modal prefilled with the recorded branch, and making the Worktree prunes the stale entry first. That reverses story 40's refusal, so it is not polish. The row could also say `gone`, which needs the API to tell the GUI.

## 7. Smaller

- The folder has no command in `⌘K`; `copy branch name` does. On a Herdr install, where the not-opened line never comes, it is only a Tab or a pointer away.
- On a `none` install `open terminal` can never open anything. `show folder` may be the more honest verb there.
- `esc` with a refusal up leaves the Ticket, where `esc` on the not-opened line stays.
- A path or branch in a history line is in sans (DESIGN.md Do's); `describe` returns a string, so mono needs it to return a node, on both describers. A Ticket's history also leaves out the folder its event carries, and an App's `created` line leaves out the Checkout it was created with.
- No key or `⌘K` row reaches the App's `checkout` field, and `go to <App>` from the modal arrives with the form shut. `set checkout…` in the palette, arriving with the caret in the field, would close the round trip that section 3 only shortens.
- The App's `checkout` row is stored text checked once, so a folder that has since moved looks fine there until a Start. The branches read could say so, and could notice a remote that disagrees with the row above.
- An edit session folds a Checkout change into the rest of its sitting, and `checkout /a → /b → /c` keeps only the ends. ADR-0008 was written for keystrokes in a body; a pointer to a folder may deserve its own line.
- Settings' refusal says `worktree_root:` under a field labelled `worktree root`; `FIELD_LABELS` in `web/src/api.ts` has no entry.
