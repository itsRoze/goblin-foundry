# Contrast on every surface, not only the tile

**Found:** the close-out of issue 10 (2026-09-04), by `/impeccable critique` on the board and the Ticket view. Two independent browser passes measured the same thing.

Issue 10 lifted `--gf-mute` to `#A3AFA6` so it clears 4.5:1 on `--gf-raised` (4.76) as well as `--gf-tile` (5.49) and `--gf-page` (6.41), and DESIGN.md Colors now states the text-safe rule against the raised step. Two colours were measured failing on the same surfaces and were left alone, because both belong to earlier slices and neither is issue 10's to change:

- **`--gf-human` `#E67E80` on `--gf-raised` = 3.95:1.** This is `.gf-btn.is-danger` — `cancel`, `trash`. Issue 04 put red on a destructive control, which DESIGN.md already records as "a standing tension with the one job rule that these notes record rather than resolve". The contrast number is a second cost of that decision and should be weighed with it, not separately.
- **`--gf-dim` `#7A8478` on `--gf-tile` = 3.21:1** painting `li::marker` in a rendered design (`app.css`, the editor's list styling from issue 07). Colors says `--gf-dim` is for handles and dividers and fails contrast deliberately — but an ordered list's numbers are content, not a handle. Either the markers take `--gf-mute`, or Colors says that a marker is a handle and means it.

**What to do:** one pass over every token/surface pair the app actually renders, with the ratios written into Colors as a table rather than a sentence. The check is a rendered screen — `bun run lint` refuses a hex literal and a dead class, and can see neither of these (LESSONS 2026-09-03, "the stylesheet linter catches what you wrote, not what you left out").

**2026-09-17, issue 03b's close-out:** the selection bar adds two more `.gf-btn.is-danger` on `--gf-raised` (`trash`, and the trash question's button), measured again at 3.95:1. `#EB8E90` would be 4.54:1 and `#EC9092` 4.62:1 on that surface. Left for this ticket: it is a token, and the token is the owner's.
