# 08: Project dependency graph

**What to build:** The Project view gets a dependency graph tile: every ticket in the project as a diamond node coloured by status meaning, edges from blocker to blocked, dashed when the blocker is open, laid out with dagre and rendered as our own SVG. Hovering a node shows a popover with key, title, status and the first line of the description; clicking opens the Ticket view. It should look excellent by DESIGN.md's standards — flat, square, colour by meaning, legend as copy. Read-only: edges are created on the Ticket view, not here.

**Blocked by:** 05 (Dependencies and the ready frontier)

**Status:** ready-for-agent

- [ ] Graph renders all project tickets and dependencies; layout is left-to-right by blocking order
- [ ] Node colour and edge style follow DESIGN.md §6 dependency graph; blocked/cancelled/done treated per §3
- [ ] Hover popover (120 ms) and click-to-open
- [ ] Responsive inside its tile (scrolls, never the page); reduced-motion honoured
- [ ] Browser smoke: two dependent tickets render two nodes and one edge; clicking a node opens the ticket
- [ ] (from 02 grill, ADR-0007) out-of-project blockers/blocked tickets are drawn as mute "external" diamonds
