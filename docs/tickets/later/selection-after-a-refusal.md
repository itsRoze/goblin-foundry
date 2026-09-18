# After "Nothing changed": a way to act on the refusal

**Found:** the close-out of issue 03b (2026-09-17), by `/impeccable critique` on the board.

A refused bulk action keeps the whole Selection, which is right (ADR-0010: all or none, and the set is still what you gathered). But when nine of eleven Tickets are why, getting to "approve the two that can" is nine boxes unticked by hand, reading keys off the refusal list. All-or-none on the server leaves the partial-success bookkeeping with the human.

**What to decide:** whether *Nothing changed* carries one verb — `deselect these 9` — that drops the named offenders from the Selection and sends nothing. It is not partial success: the second action is still one atomic batch over an explicit set, asked for separately. It is a flow change, not polish, which is why it is here and not in 03b.

**Also seen, smaller:** after `cancel` on a bulk question by touch, focus falls to `body` rather than back to the verb that asked (`bulk-trash`, which the question replaced while it stood). A keyboard user on desktop is unaffected — focus stays in the bar.
