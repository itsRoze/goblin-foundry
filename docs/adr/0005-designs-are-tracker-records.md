---
status: accepted
date: 2026-08-27
supersedes: BLUEPRINT-v1 §3.1 "designs are markdown in the app repository, tracker stores path + sha"
---
# Designs live in the tracker as markdown, not in the app repository

The blueprint stored designs as files in the app repo with an append-only `path + sha` revision record. S1 instead stores a markdown `design` column on Project and on Ticket, edited in place. Reasons: tickets can exist without a repository; design files in the product repo felt like cluttering the product ("rotting the garden"); and the only hard requirement — a run is judged against the design it started with — is met by copying the text into the S2 input snapshot at claim time. Markdown is the sole stored form; the GUI renders it (Linear-style editor) and never stores derived HTML.

## Consequences

- No `DesignRevision` table and no sha in S1; history is the `event` log (prior/new bodies).
- "A PR proposes a design change" (blueprint §3.1, S6+) becomes a proposed tracker edit rather than a file diff.
- The controller (S5) injects the design into the sandbox prompt; the agent does not read it from the repo.
- Raw HTML inside the markdown is not a stored derived form but it is still HTML: the editor's
  schema does not model it, so the next edit reduces it to the literal text of itself
  (entity-escaped) and it is never rendered as markup. Markdown a planning agent wrote is not a
  trusted document.
- Because history is the only version history, it has to be legible: an `updated` event is one
  edit session, not one autosaved write (ADR-0008), and it carries the full body so a design can
  be recovered from it.
