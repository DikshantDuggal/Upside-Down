# context.md - AgentSync shared project context

## One consistent problem
Build AgentSync: a local-first workspace where four hackathon laptops coordinate coding tasks, see API contract changes, resolve conflicting edits, and queue GitHub updates when the internet drops.

## What this handoff is
This is a predefined hackathon demo plan inside Upside Down. Uploads select local file metadata only; the uploaded contents are not parsed or sent anywhere. Every input produces the same supplied ARCHITECTURE.md and CONTRACT.md. Planning, device identities, tool choices and assignment progress are simulated; no LLM, real laptop discovery or remote code execution is claimed.

## Read order on every laptop
1. context.md (this common coordinator brief)
2. ARCHITECTURE.md (the supplied source, unchanged)
3. CONTRACT.md (the supplied source, unchanged)
4. Your assigned P1, P2, P3 or P4 prompt

## Four laptops, four boundaries
Laptop A / P1: coordinator and SQLite.
Laptop B / P2: React frontend.
Laptop C / P3: HTTP API, shared schemas and SSE.
Laptop D / P4: bridge, GitHub adapter and QA.
The architecture's reproducible event scenario uses three active simulated agents; the fourth laptop owns the dashboard. Four laptop assignments do not mean four live connected machines.

## Build order
Freeze the shared interface and fixtures first. P1 implements CoordinatorService while P3 starts against a fake service. P2 uses fixtures before the API is ready. P4 posts only through HTTP. Integrate at the architecture's G0-G4 gates. Persist before broadcast, retain event IDs on retries, and keep GitHub optional.

## Demo story
An API contract changes; one consumer acknowledges it; another is explicitly incompatible and receives a conflict. Disable public internet while retaining localhost/LAN. Local events continue and cloud jobs queue. Reconnect and sync if configured. A human resolves conflicts. There is no automatic merge.

## Integration rules
Use exactly the supplied contract's paths, record shapes, enums, errors and service signatures. One owner per folder. Request a handoff before editing another owner's files. Use additive changes and obtain affected-owner approval for incompatible changes. Never infer incompatibility from natural language. Never expose secrets or claim a remote sync without a real remote URL.

## Running the existing Upside Down demo
This demo is an additive frontend presentation. Existing Upside Down APIs retain their current UD-IC contract. The supplied AgentSync V1 specification is a teaching / handoff artifact, not a replacement for the running application's backend contract. Do not overwrite or migrate the existing website to implement these prompts.

## Prompt access
The website's laptop selector demonstrates role-scoped views; it is not authentication. All bundled documents are public demo artifacts. Real multi-device authorization and execution are outside this prototype. A host may inspect all packs; a selected laptop sees its own role prompt plus the three common documents.
