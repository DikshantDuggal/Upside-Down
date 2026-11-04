# P2 - Laptop B: Frontend & experience

Read context.md, ARCHITECTURE.md and CONTRACT.md in full before starting. They are included in your PDF.

## Your objective
Make the invisible teamwork visible.

## Owned files
- web/**

## Branch
demo/p2-frontend (illustrative assignment; no branch is created by this demo)

## Deliverables
1. Build agents, tasks, activity, conflicts and sync panels
2. Start with labeled fixtures, then connect to the public API
3. Refetch affected lists on state.changed SSE events
4. Handle loading, empty, offline, errors and manual conflict review

## Ownership boundary
Do not read databases, edit server internals or expose GitHub tokens.

## Handoff
Consume P3's response fixtures and /api endpoints; demonstrate the P4 scenario.

## Acceptance
Run the tests assigned to P2 in CONTRACT.md section 12. Report the exact commands, observed results, changed files, interface assumptions and outstanding blockers. Keep fixtures labeled DEMO DATA. Do not claim remote execution or unrun tests.

## Integration
Use the supplied API shapes without renaming. Request explicit handoffs for other owners' files. Provide a small reviewable commit on your assigned branch. Integrate only after shared interface agreement and local checks; do not auto-merge. GitHub sync is opt-in, server-side and best effort.

## Preserve the existing product
This pack describes the AgentSync reference project. Do not replace the running Upside Down application or its contract. If asked to implement, use a separate approved project directory and verify scope with the human.
