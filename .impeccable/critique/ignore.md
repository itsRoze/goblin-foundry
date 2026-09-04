# Standing exceptions for `/impeccable critique`

Findings that match one of these are the house style, not a defect; drop them. Each names the DESIGN.md section that decided it. When the section changes, delete the line.

- **Tight leading on row and card titles** (`line-height: 1.25` at 14px): Typography sets titles at 14/1.25; body runs 13.5/1.5. Not a legibility bug.
- **Flat type hierarchy / sizes too close** (11, 11.5, 13.5, 14, 15): Typography is a deliberately tight UI ramp where mono against sans, weight and colour carry the difference, not size. Prose headings inside a design use the six-step ladder in Typography.
- **The same `app / project` line on every card**: Interaction makes it a view option on the kanban card, shown per card because a board can mix projects. Not redundant messaging.
- **No border radius, no shadows, no gradients, no blur**: Shapes and Elevation & Depth. `bun run lint` refuses them.
- **Glyphs (◆ ● ◇ ▪ ≡ ×) instead of an icon set**: Deliberately not specified. An icon set arrives only when a glyph fails.
- **Mono uppercase tracked labels as tile headers and kv keys** (Typography label role, Components tile): they are the tile's title and the row's key, not a kicker or eyebrow above a heading.
- **Monospace on keys, ids, paths, numbers and labels**: Typography, mono is a signal for data. Mono on a whole paragraph *is* a finding.
- **`--gf-dim` (#7A8478) failing contrast**: Colors, deliberately; it is for handles and dividers, never words. `--gf-mute` on words that fails 4.5:1 *is* a finding.
- **Blocked shown as an outline glyph and strikethrough, with no colour**: Colors. Blocked is never a colour.
- **Refusals as an inline mono sentence rather than a toast or modal**: Components.
- **No light mode, no theme switch**: Deliberately not specified, dropped for now.
- **One ambient animation, 120ms hover and 200ms moves, nothing else**: Motion.
