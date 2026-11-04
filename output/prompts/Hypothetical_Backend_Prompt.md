# Build a standalone mock backend for Upside Down

You are implementing a runnable hypothetical backend prototype, not modifying the existing website. Start working directly. Use deterministic fixtures instead of paid AI APIs. Clearly label simulation in responses and logs.

## Product and primary pipeline
Upside Down helps hackathon students coordinate different coding tools across multiple laptops and understand what they build. Pipeline: upload problem statement -> discuss/refine idea -> approve architecture and shared contract -> assign one role prompt per laptop -> approve start -> track parallel work and changes -> review patches/conflicts -> integrate verified results -> learn the project visually and prepare a presentation.

## Preserve the existing product
Create a NEW standalone directory named upside-down-mock-backend. Do not edit, reset, migrate, install dependencies into, or stop processes belonging to the existing Upside Down repository. Use port 4300, default bind 127.0.0.1. LAN binding must be explicit. Never replace the current UD-IC endpoints or database. Deliver backend code, fixtures, tests, API documentation and integration examples; frontend integration is a later separate task.

## Stack and operation
Use TypeScript, Node.js, Express, SQLite and Zod. Pin compatible package versions. Persist project state and events in a dedicated SQLite file. Provide npm scripts for dev, build, start, test and demo:reset. Include .env.example with no secrets. The basic demo must run without internet or model credentials after dependency installation.

## One consistent reference project
Use AgentSync as the sample project: a local-first control plane for coding agents on one repository, with task ownership, contract-change notifications, human conflict review and an offline GitHub outbox. If supplied, read ARCHITECTURE.md and CONTRACT.md as reference data and preserve their contents. Otherwise document your proposed mock interface as a new prototype contract, not an agreed change to the real application.

Four role assignments:
- Laptop A / P1: coordinator and SQLite; server/src/core/** and server/src/db/**.
- Laptop B / P2: frontend; web/**.
- Laptop C / P3: API, validation and SSE; server/src/http/** and shared/**.
- Laptop D / P4: bridge, optional GitHub adapter and QA; bridge/**, server/src/integrations/**, scripts/** and tests/e2e/**.

Create one shared context.md, architecture.md and contract.md, plus four individual prompts. Each prompt contains objective, owned paths, forbidden edits, inputs, deliverables, interface dependencies, tests and handoff checklist. All roles use the same project ID and plan revision.

## Required backend behavior
1. Accept a text brief or PDF/Markdown upload. Enforce extension/size limits, sanitize display names, use generated storage IDs and never execute file content. This prototype does not need OCR or PDF understanding: store metadata and return the fixed reference plan with sourceMode=fixture. Do not say the file was analyzed.
2. On explicit generation submission, create a persisted job with readyAt 25 seconds later. Before that time return preparing with progress; after that return ready with the fixed plan. Merely opening the site or selecting a file must not create a job. Support cancellation and repeated polling without duplicate jobs.
3. Return three seeded idea options and accept user refinement text. Preserve user text, but explain that planning is deterministic. Require explicit idea/plan approval and explicit start; generation alone never starts workers.
4. Register four mock devices, role assignments, declared tool labels and capability flags. Codex, Claude Code, Antigravity and Other are labels, not working commercial-tool integrations. Provide a simulated heartbeat and event scheduler; do not execute arbitrary shell commands or control external tools.
5. Host session can inspect all roles. A worker token can read only its own prompt and shared project documents. Enforce this on the server, not just the UI. Issue separate random tokens; store hashes and keep credentials out of logs, source, URLs and SSE payloads. Provide a local bootstrap command for test sessions. Do not reuse production credentials.
6. Seed eight tasks, four agents, six activity events, two patches, two conflicts, four messages and four queued updates with stable IDs. Implement task filtering/status updates, review decisions, conflict resolution with a note, local team messages and queue replay. Clearly mark all generated events simulated=true. Reject invalid transitions and stale revisions with 409.
7. Stream persisted ordered events using SSE with increasing sequence numbers and a GET recovery endpoint. Support Last-Event-ID replay; announce a reset if history is unavailable. Persist before broadcasting. Scope streams and payloads to the authorized project/role.
8. Mid-run change requests create a new proposed plan revision, an impact summary and affected roles. Require host approval before applying. Pause affected mock tasks, update prompts and require acknowledgement. Never silently rewrite active assignments.
9. Simulate proposal -> review -> integration states. Never claim real commits, test execution, merges, deployment or GitHub sync. Use null for real commit hashes and URLs. A successful mock review is not proof that code was applied. Keep real execution/GitHub adapters disabled and document extension points.
10. Serve a learning manifest with the five-step example flow: bridge -> HTTP validation -> coordinator/SQLite -> SSE/frontend -> optional GitHub outbox. Include four illustrative files, sample functions, explanations, concepts, one quiz and presentation notes. Mark code as illustrative and traces as simulated; do not claim repository analysis.

## Proposed isolated API
Use /demo-api/v1 only. Return {data, meta:{simulation:true, projectId, revision}} and errors {error:{code,message}}. Document exact request/response schemas before implementing consumers.
- POST /projects; GET /projects/:id
- POST /projects/:id/uploads; POST /projects/:id/generation; GET /jobs/:id; POST /jobs/:id/cancel
- GET /projects/:id/ideas; POST /projects/:id/refinements
- GET /projects/:id/plan; POST /projects/:id/approve; POST /projects/:id/start
- GET /projects/:id/documents/:name; GET /projects/:id/prompts/:role
- GET /projects/:id/devices; GET/PATCH /projects/:id/tasks[/:taskId]
- GET /projects/:id/patches; POST /projects/:id/patches/:patchId/review
- GET /projects/:id/conflicts; POST /projects/:id/conflicts/:conflictId/resolve
- GET/POST /projects/:id/messages
- GET /projects/:id/queue; POST /projects/:id/queue/replay
- GET /projects/:id/events?afterSequence=N; GET /projects/:id/stream
- POST /projects/:id/change-requests; POST /projects/:id/change-requests/:changeId/approve
- GET /projects/:id/learning

Use idempotency keys for command POSTs and store request hashes: same key/same payload returns the original result, changed payload returns 409. All timestamps are ISO UTC. Validate project membership and role on every endpoint. State clearly which GET lists need separate item mutation routes in your finalized OpenAPI document. Restrict CORS to configured origins; do not use wildcard origins with credentials.

## Acceptance and delivery
Test: no plan before explicit submission or before readyAt; correct behavior after 25 seconds and restart; cancellation; duplicate commands; wrong-role prompt denied; all four shared documents/role prompts consistent; persisted tasks/messages; conflict revision checking; SSE replay and isolation; offline queue; change approval; no real shell/GitHub/model calls. Use fake time for timing unit tests and include one runnable manual demo walkthrough.

Deliver a working standalone backend, seed data, OpenAPI specification, README with exact setup commands, four role prompts/common documents, and curl examples covering the entire pipeline. End with verified commands/results, known limitations and proposed frontend adapter steps. Do not claim integration into the existing website until explicitly asked and tested.
