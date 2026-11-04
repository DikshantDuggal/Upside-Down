# P1 - Laptop A: Backend & coordinator

Read context.md, ARCHITECTURE.md and CONTRACT.md in full before starting. They are included in your PDF.

## Your objective
Give the team a durable source of truth.

## Owned files
- server/src/core/**
- server/src/db/**

## Branch
demo/p1-coordinator (illustrative assignment; no branch is created by this demo)

## Deliverables
1. Implement CoordinatorService and task / agent registries
2. Persist events, file claims, conflicts and outbox in SQLite
3. Deduplicate event IDs and commit before notifying listeners
4. Test restart recovery and competing file claims

## Ownership boundary
Do not edit HTTP handlers, the UI or GitHub adapters.

## Handoff
Expose CoordinatorService to P3; supply a narrow OutboxRepository to P4.

## Acceptance
Run the tests assigned to P1 in CONTRACT.md section 12. Report the exact commands, observed results, changed files, interface assumptions and outstanding blockers. Keep fixtures labeled DEMO DATA. Do not claim remote execution or unrun tests.

## Integration
Use the supplied API shapes without renaming. Request explicit handoffs for other owners' files. Provide a small reviewable commit on your assigned branch. Integrate only after shared interface agreement and local checks; do not auto-merge. GitHub sync is opt-in, server-side and best effort.

## Preserve the existing product
This pack describes the AgentSync reference project. Do not replace the running Upside Down application or its contract. If asked to implement, use a separate approved project directory and verify scope with the human.
