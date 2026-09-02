# 12: Bootstrap Subway Reader with the planning skill

**What to build:** The S1 exit criterion, walked for real. A Claude Code planning skill (wayfinder-style) that reads the App and Project (including the Project Design) through `goblin`, runs the planning conversation with me, and writes vertical-slice tickets with Ticket Designs and dependencies through `goblin` as actor `agent` (so they land in `planning`; the API refuses an agent creating anywhere else or triggering any Transition — approval is yours, on the board or with `goblin ticket approve` without `--actor`). Then: create the App "Subway Reader" (repository URL) and Project "MVP" in the GUI, paste the existing project design (from `research/subway-reader/PROJECT-DESIGN.md`) into the Project Design editor, run one planning session, approve the resulting tickets on the board, drag a couple around, and confirm the ready frontier on screen matches the dependency graph. Record what was awkward in `LESSONS.md`.

**Blocked by:** 07 (Linear-style markdown editor for designs and descriptions), 09 (`goblin` CLI)

**Status:** ready-for-agent

- [ ] Planning skill exists, documented, and only ever calls `goblin`
- [ ] Subway Reader App and MVP Project created in the GUI with the project design pasted in
- [ ] One real planning session produces ≥ 5 tickets with designs and dependencies, all in `planning`, none in `ready`
- [ ] Approving them in the GUI moves them to `ready`; blocked ones are struck through; `GET /frontier` agrees with the board
- [ ] Drag-and-drop between statuses works on those tickets
- [ ] `LESSONS.md` updated with friction found
