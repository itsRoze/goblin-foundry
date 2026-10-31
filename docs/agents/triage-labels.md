# Triage Labels

Goblin has no labels. A ticket's triage state is its **status**, and the five
canonical roles the skills speak in collapse onto three of them.

| Role in mattpocock/skills | In Goblin                                                                   |
| ------------------------- | --------------------------------------------------------------------------- |
| `needs-triage`            | `backlog` — an idea, not yet evaluated                                       |
| `ready-for-agent`         | `ready`, and so on the frontier                                              |
| `wontfix`                 | `cancelled`, via `goblin ticket cancel`                                      |
| `needs-info`              | _dropped_ — leave it in `backlog` with the open question in the description  |
| `ready-for-human`         | _dropped_ — Goblin has no assignee; park it in `planning` for the human     |

Apply a role by moving the ticket, never by tagging it: `pick`, `plan`,
`shelve`, `approve`, `cancel`. `goblin ticket --help` lists every verb, and
`goblin ticket <verb> --help` the edges it travels.

Two rules follow from the model rather than from taste:

- **An agent reaches `ready-for-agent` itself.** Either Actor may `approve`
  (ADR-0012), so a triage pass the human has agreed to ends at `ready`. When
  the human wants to review the result first, end at `planning` and say so.
- **`ready` is earned, not declared.** The approve guard wants an app, and a
  description or a ticket design unless the ticket is `--simple`. A ticket
  that cannot be approved is missing one of those two, and the refusal names
  which.

Don't reintroduce the two dropped roles as a `Triage:` line in the description.
That is a shadow field the tracker cannot filter, sort or refuse on, and it
would drift from the status that actually governs the ticket.
