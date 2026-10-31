# Triage Labels

A ticket's triage state is its **status** where a status can carry it, and a
**label** where it cannot (ADR-0013). Three of the five canonical roles the
skills speak in are statuses; the other two are labels.

| Role in mattpocock/skills | In Goblin                                                                        |
| ------------------------- | -------------------------------------------------------------------------------- |
| `needs-triage`            | the status `backlog`: an idea, not yet evaluated                                 |
| `ready-for-agent`         | the status `ready`, and so on the frontier                                       |
| `wontfix`                 | the status `cancelled`, via `goblin ticket cancel`                               |
| `needs-info`              | the label `needs-info` on a `backlog` ticket; the question is in its description |
| `ready-for-human`         | the label `ready-for-human` on a `ready` ticket; Goblin has no assignee          |

Apply a status role by moving the ticket: `pick`, `plan`, `shelve`, `approve`,
`cancel`. `goblin ticket --help` lists every verb, and `goblin ticket <verb>
--help` the edges it travels. Apply a label role with `goblin ticket label add
<key> needs-info` (or `--labels needs-info` on `ticket create`), and take it off
with `goblin ticket label remove <key> needs-info` once the question is answered
or the human has taken the ticket. `goblin ticket list --label needs-info` is
the queue for a role, and so is the board at `?label=needs-info`.

The frontier still lists a `ready-for-human` ticket. When you work the
frontier, pass over any ticket carrying it.

Two rules follow from the model rather than from taste:

- **An agent reaches `ready-for-agent` itself.** Either Actor may `approve`
  (ADR-0012), so a triage pass the human has agreed to ends at `ready`. When
  the human wants to review the result first, end at `planning` and say so.
- **`ready` is earned, not declared.** The approve guard wants an app, and a
  description or a ticket design unless the ticket is `--simple`. A ticket
  that cannot be approved is missing one of those two, and the refusal names
  which.

Never label a ticket with a status role (`needs-triage`, `ready-for-agent`,
`wontfix`): the status already says it, and a label would drift from the
status that actually governs the ticket. Never write a role as a `Triage:`
line in the description either: that is a shadow field the tracker cannot
filter on.
