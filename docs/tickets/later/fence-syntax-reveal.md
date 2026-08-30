# later: a fence shows its ``` too

**What to build:** A code block reveals its opening and closing fences — ```` ```ts ```` and ```` ``` ````
— while the caret is inside it, the way an inline span reveals its backticks (issue 07).

**Blocked by:** 07. Deferred from it — see below.

**Status:** needs grilling

## Why it was deferred rather than dropped

Asked for inline `` ` `` reveal, the same question applies to a fence, and it was left out for reasons
that are real but not insurmountable:

- A fence's markers are two whole **lines**, not two characters. Showing them on entry moves everything
  below the block down — the layout-shift bug that made buttons unclickable under a focused field
  (`docs/LESSONS.md`, 2026-08-30). Reserving two lines of padding in every code block, always, is the
  obvious fix and is visually expensive.
- The information is already reachable: the mode line's right slot shows and edits the fence's language
  while the caret is in the block, and `fence` takes the block off.

So it is a cost question, not a design objection. If it is built, the space has to be reserved whether or
not the fence is showing, exactly as the mode line's is.

- [ ] Decide the reservation: two lines always, or the markers drawn inside the block's existing padding
- [ ] A node decoration carrying the language, so the opening marker can read ```` ```ts ````
- [ ] Entering and leaving the block must not move anything below it
- [ ] Browser smoke: click into a fence, see both markers; click out, see them go; the stored markdown
      is unchanged either way
