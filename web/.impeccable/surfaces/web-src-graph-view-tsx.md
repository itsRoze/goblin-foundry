---
version: 1
slug: "web-src-graph-view-tsx"
primary_target: "web/src/graph-view.tsx"
related_targets: ["web/src/graph.ts","web/src/graph-viewport.ts"]
---

# Project dependency graph
Operate mode. Inspect the real Subway Reader snapshot: 22 tickets and 29 dependencies. Preserve ticket navigation, blocked state, status and external context; live tracker data is never edited for previews. Code-led local graph redesign; no raster comp: geometry is drawn from real graph data.

## Direction contract
THESIS: Make prerequisite chains legible through individually routed connections and hover tracing, replacing the overlapping comb of indistinguishable wires.
OWN-WORLD: Inherit Goblin's Everforest palette, square panels and mono ticket keys. Graph lines gain rounded bends and directional tips; blocked diamonds remain hollow, with full readable titles in a separate detail region.
STORY: See the entire topology, trace a ticket's prerequisites and downstream work, zoom to read, then open the ticket.
FIRST VIEWPORT: Fit the complete graph inside its canvas. Compact ticket markers carry keys in the numeric mono role; keyboard focus restores readable scale, and zoom controls support inspection. Controls above provide zoom, fit and expansion. Below, a stable detail region names the hovered ticket and counts its traced relationships without obscuring wires.
FORM: Local extension, no concept seed required. Signature interaction: pointer hover and keyboard focus illuminate every upstream and downstream path in distinct named colors; base edges recede. Hover waits 120ms; keyboard focus highlights immediately, with no decorative animation. The expanded canvas is the inspection workspace.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Shipped implementation

The map uses compact square markers (28px high; width `max(68, key.length * 9 + 22)`) with the existing 15px numeric mono key role and filled status diamonds, hollow for blocked tickets. Source geometry routes curves through reserved lanes with independent sorted source and destination ports and directional tips. Dashed open dependencies and solid satisfied dependencies retain their original meaning.

The initial camera fits the full topology. Workspace width below 760px switches the map from left-to-right to top-to-bottom. Hover and keyboard focus trace every reachable prerequisite and downstream ticket separately; gold names prerequisites and teal names downstream work. A stable 140px scrollable region below the map shows the full title link, status, relationship counts, blockers, description excerpt and external project context. Camera controls, pointer pan, pinch zoom, keyboard navigation and native-dialog expansion remain available.

Source evidence: `web/src/graph.ts`, `web/src/graph-view.tsx`, `web/src/graph-viewport.ts`, the graph rules in `web/src/app.css`, and the existing type roles in `design/tokens.css`. Review captures live under `.impeccable/review/subway-*.png`; `desktop.png` and `mobile.png` record the surrounding surface. These are preview captures of the real snapshot, not shipping raster assets. No raster asset was introduced.
