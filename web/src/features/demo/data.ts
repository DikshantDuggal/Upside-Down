export const DEMO_PROBLEM =
  "Build AgentSync: a local-first workspace where four hackathon laptops coordinate coding tasks, see API contract changes, resolve conflicting edits, and queue GitHub updates when the internet drops.";

export const roles = [
  {
    id: "P1",
    letter: "A",
    name: "Backend & coordinator",
    short: "Backend",
    color: "sage",
    tool: "Codex",
    branch: "demo/p1-coordinator",
    paths: ["server/src/core/**", "server/src/db/**"],
    goal: "Give the team a durable source of truth.",
    tasks: [
      "Implement CoordinatorService and task / agent registries",
      "Persist events, file claims, conflicts and outbox in SQLite",
      "Deduplicate event IDs and commit before notifying listeners",
      "Test restart recovery and competing file claims",
    ],
    boundary: "Do not edit HTTP handlers, the UI or GitHub adapters.",
    handoff:
      "Expose CoordinatorService to P3; supply a narrow OutboxRepository to P4.",
    concept: "Persistence",
    explanation:
      "SQLite remembers accepted events after a restart. The coordinator saves an event and its outbox entry in one transaction, so they succeed or fail together.",
    sample:
      "async function appendEvent(input) {\n  const existing = await events.find(input.eventId);\n  if (existing) return { item: existing, duplicate: true };\n  const item = await transaction(() => persistEventAndOutbox(input));\n  notifyChange(item); // after commit\n  return { item, duplicate: false };\n}",
    file: "server/src/core/coordinator.ts",
  },
  {
    id: "P2",
    letter: "B",
    name: "Frontend & experience",
    short: "Frontend",
    color: "lavender",
    tool: "Claude Code",
    branch: "demo/p2-frontend",
    paths: ["web/**"],
    goal: "Make the invisible teamwork visible.",
    tasks: [
      "Build agents, tasks, activity, conflicts and sync panels",
      "Start with labeled fixtures, then connect to the public API",
      "Refetch affected lists on state.changed SSE events",
      "Handle loading, empty, offline, errors and manual conflict review",
    ],
    boundary:
      "Do not read databases, edit server internals or expose GitHub tokens.",
    handoff:
      "Consume P3's response fixtures and /api endpoints; demonstrate the P4 scenario.",
    concept: "Server-sent events",
    explanation:
      "SSE is a one-way connection from the server to the browser. A tiny change notification tells the UI which list to fetch again, keeping the interface current without sending every object twice.",
    sample:
      "const stream = new EventSource('/api/stream');\nstream.addEventListener('state.changed', (event) => {\n  const change = JSON.parse(event.data);\n  refreshList(change.entity);\n});\n// On reconnect: recover events after the last sequence.\n// If SSE is unavailable: poll every two seconds.",
    file: "web/src/hooks/useActivity.ts",
  },
  {
    id: "P3",
    letter: "C",
    name: "API & realtime",
    short: "API",
    color: "blue",
    tool: "Antigravity",
    branch: "demo/p3-api",
    paths: ["server/src/http/**", "shared/**"],
    goal: "Make every module speak the same language.",
    tasks: [
      "Freeze schemas, fixtures and the CoordinatorService interface",
      "Validate requests and implement the CONTRACT.md endpoints",
      "Map domain errors to HTTP status and canonical error envelopes",
      "Broadcast state.changed over SSE and test recovery / validation",
    ],
    boundary: "Do not query SQLite directly or implement UI / GitHub adapters.",
    handoff:
      "Call P1's service through the frozen interface; give fixtures to P2 and P4.",
    concept: "API contracts",
    explanation:
      "A contract defines what callers send and what they receive. Runtime validation checks real incoming data, while the shared TypeScript interface helps developers connect modules before running them.",
    sample:
      "app.post('/api/events', async (req, res) => {\n  const input = eventInputSchema.parse(req.body);\n  const result = await coordinator.appendEvent(input);\n  res.status(result.duplicate ? 200 : 201).json(result);\n});\n// Routes depend on the service, never on SQLite tables.",
    file: "server/src/http/events.ts",
  },
  {
    id: "P4",
    letter: "D",
    name: "Agent bridge & QA",
    short: "Bridge + QA",
    color: "peach",
    tool: "Other / CLI",
    branch: "demo/p4-bridge-qa",
    paths: [
      "bridge/**",
      "server/src/integrations/**",
      "scripts/**",
      "tests/e2e/**",
    ],
    goal: "Connect the pieces and prove the story.",
    tasks: [
      "Create four named demo identities and three scripted active agents",
      "Register agents and send stable-ID events through HTTP",
      "Implement optional GitHub outbox sync with visible retries",
      "Run contract-change, conflict, offline, restart and reconnect scenarios",
    ],
    boundary:
      "Do not import coordinator internals, edit HTTP handlers or access SQLite directly.",
    handoff:
      "Use P3's HTTP API and P1's narrow outbox interface. Return scenario evidence to all owners.",
    concept: "Idempotency",
    explanation:
      "A network retry may deliver the same request twice. Reusing an eventId lets the server return the original result without creating a second event or another sync job.",
    sample:
      "await post('/api/agents', demoAgent);\nconst event = { eventId: 'evt-contract-001',\n  agentId: 'agent-a', type: 'contract.changed',\n  source: 'cli', occurredAt: new Date().toISOString(),\n  payload: fixedContractChange };\nawait post('/api/events', event);\n// Retrying uses the SAME eventId.",
    file: "bridge/scenarios/contract-change.ts",
  },
] as const;
export type Role = (typeof roles)[number];
export type RoleId = Role["id"];

export const context = `# context.md - AgentSync shared project context

## One consistent problem
${DEMO_PROBLEM}

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
`;

export function rolePrompt(role: Role) {
  return `# ${role.id} - Laptop ${role.letter}: ${role.name}\n\nRead context.md, ARCHITECTURE.md and CONTRACT.md in full before starting. They are included in your PDF.\n\n## Your objective\n${role.goal}\n\n## Owned files\n${role.paths.map((p) => `- ${p}`).join("\n")}\n\n## Branch\n${role.branch} (illustrative assignment; no branch is created by this demo)\n\n## Deliverables\n${role.tasks.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\n## Ownership boundary\n${role.boundary}\n\n## Handoff\n${role.handoff}\n\n## Acceptance\nRun the tests assigned to ${role.id} in CONTRACT.md section 12. Report the exact commands, observed results, changed files, interface assumptions and outstanding blockers. Keep fixtures labeled DEMO DATA. Do not claim remote execution or unrun tests.\n\n## Integration\nUse the supplied API shapes without renaming. Request explicit handoffs for other owners' files. Provide a small reviewable commit on your assigned branch. Integrate only after shared interface agreement and local checks; do not auto-merge. GitHub sync is opt-in, server-side and best effort.\n\n## Preserve the existing product\nThis pack describes the AgentSync reference project. Do not replace the running Upside Down application or its contract. If asked to implement, use a separate approved project directory and verify scope with the human.\n`;
}

export const pipeline = [
  {
    name: "Agent emits",
    owner: "P4",
    subtitle: "A shared contract changes",
    detail:
      "The bridge posts evt-contract-001 to /api/events. Stable event IDs make retrying safe.",
    code: "POST /api/events → eventId: evt-contract-001",
  },
  {
    name: "API validates",
    owner: "P3",
    subtitle: "Check the agreed shape",
    detail:
      "The HTTP layer validates the event type, registered agent and payload, then calls CoordinatorService.appendEvent.",
    code: "eventInputSchema.parse(body) → coordinator.appendEvent(input)",
  },
  {
    name: "Core persists",
    owner: "P1",
    subtitle: "Save before announcing",
    detail:
      "The coordinator deduplicates, assigns a sequence, persists the event and outbox atomically, and flags explicitly incompatible consumers.",
    code: "SQLite transaction → events + conflicts + outbox",
  },
  {
    name: "UI updates",
    owner: "P2",
    subtitle: "Make the change visible",
    detail:
      "After commit, state.changed reaches the dashboard over SSE. The browser refetches affected lists and shows the conflict for human review.",
    code: "state.changed → GET /api/conflicts → render",
  },
  {
    name: "Sync later",
    owner: "P4",
    subtitle: "Internet is optional",
    detail:
      "Without credentials or internet, the outbox stays pending. An enabled worker checks event markers before posting to GitHub; no fake success link is shown.",
    code: "pending → syncing → synced | failed",
  },
] as const;
