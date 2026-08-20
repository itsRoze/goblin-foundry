# Design: <ticket title>

**Status:** ready-for-development
**Ticket:** FAC-<n>

## Problem Statement

The problem from the user's perspective — not the solution.

## Goals

What this change must achieve. Bulleted, testable where possible. If there is a
success measure, name its counter-metric so nobody games it.

## Non-Goals

Adjacent things this deliberately does not do — possibilities excluded, not just
goals negated.

## User Stories / Scenarios

Numbered. "As a <actor>, I want <capability>, so that <benefit>." Each one
independently demonstrable where the work is big enough to slice.

## Proposed Design

Overview first, then detail: the flow of data, the interfaces and key types by
name and shape (not full code), error handling, sequencing. Use the project's
existing vocabulary; flag any new term worth adding to the glossary.

## Alternatives Considered

The options rejected and the trade-off that decided it. Skip only for genuinely
trivial work.

## Acceptance Criteria

EARS-flavoured and independently verifiable:

- WHEN <trigger>, THE <system> SHALL <response>
- IF <error condition>, THEN THE <system> SHALL <response>
- WHILE <state>, THE <system> SHALL <response>

## Test Plan

Which seams get tested and how, what is deliberately not tested, and prior art in
the codebase for similar tests.

## Risks / Open Questions

Anything still uncertain, including disagreements the three perspectives could not
settle. If something here is genuinely blocking, this ticket is not ready.

## Out of Scope

The explicit boundary — this is what stops the builder gold-plating.

## Notes for Builder

- Interfaces and behavioural contracts to look for, described by name and shape,
  never by file path or line number.
- Decisions deliberately left to the builder, with how to decide them.
