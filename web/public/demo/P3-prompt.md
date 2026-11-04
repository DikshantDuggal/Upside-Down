# P3 - Laptop C: API & realtime

Read context.md, ARCHITECTURE.md and CONTRACT.md in full before starting. They are included in your PDF.

## Your objective
Make every module speak the same language.

## Owned files
- server/src/http/**
- shared/**

## Branch
demo/p3-api (illustrative assignment; no branch is created by this demo)

## Deliverables
1. Freeze schemas, fixtures and the CoordinatorService interface
2. Validate requests and implement the CONTRACT.md endpoints
3. Map domain errors to HTTP status and canonical error envelopes
4. Broadcast state.changed over SSE and test recovery / validation

## Ownership boundary
Do not query SQLite directly or implement UI / GitHub adapters.

## Handoff
Call P1's service through the frozen interface; give fixtures to P2 and P4.

## Acceptance
Run the tests assigned to P3 in CONTRACT.md section 12. Report the exact commands, observed results, changed files, interface assumptions and outstanding blockers. Keep fixtures labeled DEMO DATA. Do not claim remote execution or unrun tests.

## Integration
Use the supplied API shapes without renaming. Request explicit handoffs for other owners' files. Provide a small reviewable commit on your assigned branch. Integrate only after shared interface agreement and local checks; do not auto-merge. GitHub sync is opt-in, server-side and best effort.

## Preserve the existing product
This pack describes the AgentSync reference project. Do not replace the running Upside Down application or its contract. If asked to implement, use a separate approved project directory and verify scope with the human.
