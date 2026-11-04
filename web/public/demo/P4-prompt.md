# P4 - Laptop D: Agent bridge & QA

Read context.md, ARCHITECTURE.md and CONTRACT.md in full before starting. They are included in your PDF.

## Your objective
Connect the pieces and prove the story.

## Owned files
- bridge/**
- server/src/integrations/**
- scripts/**
- tests/e2e/**

## Branch
demo/p4-bridge-qa (illustrative assignment; no branch is created by this demo)

## Deliverables
1. Create four named demo identities and three scripted active agents
2. Register agents and send stable-ID events through HTTP
3. Implement optional GitHub outbox sync with visible retries
4. Run contract-change, conflict, offline, restart and reconnect scenarios

## Ownership boundary
Do not import coordinator internals, edit HTTP handlers or access SQLite directly.

## Handoff
Use P3's HTTP API and P1's narrow outbox interface. Return scenario evidence to all owners.

## Acceptance
Run the tests assigned to P4 in CONTRACT.md section 12. Report the exact commands, observed results, changed files, interface assumptions and outstanding blockers. Keep fixtures labeled DEMO DATA. Do not claim remote execution or unrun tests.

## Integration
Use the supplied API shapes without renaming. Request explicit handoffs for other owners' files. Provide a small reviewable commit on your assigned branch. Integrate only after shared interface agreement and local checks; do not auto-merge. GitHub sync is opt-in, server-side and best effort.

## Preserve the existing product
This pack describes the AgentSync reference project. Do not replace the running Upside Down application or its contract. If asked to implement, use a separate approved project directory and verify scope with the human.
