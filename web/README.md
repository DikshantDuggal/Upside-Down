# Upside Down dashboard

React / TypeScript / Vite frontend for **UD-IC/1.0**. All implementation, configuration, dependencies, and tests live inside `web/`. No backend, root configuration, shared contract, or teammate-owned source is changed.

Frontend owner: Guragam Singh (`guragam-singh`). The human confirmed Backend A = Dikshant and Backend B = Arhaan, and reported team contract acceptance in the implementation session. Coordination: repository issue #1; frontend work: issue #4.

## Run on Windows

Use Node 24.20+ and npm 11.19+. From the repository root:

```powershell
npm --prefix web ci
npm --prefix web run dev
```

Open `http://127.0.0.1:5173`. Install dependencies before disconnecting the internet. The UI loads no remote fonts, images, scripts, or cloud APIs.

Both `/local/*` and `/api/*` proxy to `http://127.0.0.1:4100` by default. B supplies the durable local API and allowlisted coordinator proxy. Set `UD_LOCAL_TARGET` and `UD_API_TARGET` in the **Vite process** to change these nonsecret targets. The development proxy preserves browser Host and Origin; B must allow the explicitly configured app host/origin, normally `127.0.0.1:5173`. Do not disable Host, Origin, or CSRF checks. Production should serve `dist/` from B's same-origin authenticated host.

To read the existing coordinator before B's local service is available:

```powershell
$env:UD_API_TARGET='http://127.0.0.1:4000'
npm --prefix web run dev
```

This enables **legacy read mode**. Tasks, agents, activity, and event-discovered patches work against backend `ec73ff7b1fcc16645484709ea92c51d9dfc46068`. Queueable actions never fall back to direct legacy POST routes. An unavailable local service leaves writes unavailable and its pending count unknown.

## Implemented behavior

- Overview, task search/filter/detail, registered agents, named activity SSE, safe diff/review, team messages, conflict comparison, and network/queue views.
- Runtime-validated direct API responses, legacy/non-JSON errors, contract acknowledgement, stale headers, timeouts, cancellation, and encoded IDs. `src/api/types.ts` is a frontend validation mapping of the shared contract; it does not replace backend contracts.
- `/local/state` bootstrap before local SSE subscription using `localCursor`; refetch on `local_change`, resnapshot on `reset`, and event-ID deduplication. Remote SSE uses native reconnection/Last-Event-ID; legacy reconnects disclose possible history gaps. B owns the durable cache/log.
- Browser retry records save immutable payloads and idempotency keys before HTTP and across reload. A browser record is an **unsent draft or ambiguous retry record**, never proof of durable delivery. Only a validated HTTP 202 receipt confirms local acceptance. Missing pending receipts are looked up rather than assumed applied.
- Same-task transitions wait for acknowledgement. Restored service receipts without a known task association conservatively block all transitions rather than guessing future revisions.
- Conflict resolution reads the current task, sends guarded task/conflict revisions, requires a reason and explicit confirmation, and refreshes on 409 without automatic resubmission. Code conflicts require reproposal, not a UI semantic merge.
- Approval, application, structured tests, and task status are distinct. Legacy `done` and `testOutput` remain unverified. A verified application needs its own reported commit and passing structured evidence. Unsafe approvals/applications are disabled.
- Runs, cancellation, task patch lists, applications, and metadata-only checkpoints use documented proposed routes and advertised capabilities. Unavailable features remain visible as unavailable. Runtime availability never claims LLM execution.
- Responsive navigation, native modal focus/Escape/return focus, semantic labels, reduced motion, text-and-color status, contrast checks, and bounded diff previews with full patch download.

## Session integration for Backend B

The additive handshake was accepted on the board by Backend A (`6614132100`), frontend (`6614135924`), and Backend B (`6614142386`/`6614227630`). The UI now provides **Pair browser** in Network & queue and when a local session is required.

Start B with `UD_ALLOWED_ORIGINS=http://127.0.0.1:5173`. Paste the **local pairing key** from the private `.session.json` file beside its device database. The UI sends `POST /local/session` with `{pairingKey}`, receives `{contractVersion,csrfToken}` plus an HttpOnly/SameSite=Strict cookie, and uses `GET /local/session` to restore the CSRF token on reload. Writes use `X-CSRF-Token`; commands also use their stable `Idempotency-Key`. Pairing keys and CSRF tokens are never stored in localStorage or command records. Sessions expire after 12 hours and require pairing again after B restarts; SQLite commands remain intact.

An authenticated host may also supply session hints through this in-memory frontend hook:

```ts
window.upsideDownSession?.update({
  csrfToken: csrfTokenFromAuthenticatedSession,
  canReview: reviewerCapabilityFromServer,
});
```

The hook accepts no device bearer token. `canReview` is a UI hint; A/B enforce authorization. Normal local pairing always sets `canReview:false`. Reviewer actions remain unavailable until A/B implement and agree their separate reviewer authority. The cookie can be discarded through browser site-data controls; clearing a UI hint is not server-side logout. Never place credentials in `VITE_*`, localStorage, URLs, or the repository.

Online-only runs/decisions/applications/resolutions retain request keys after ambiguous failures and are never enqueued or automatically retried. Retry original values or reconcile the server job before changing an unknown request. Browser storage failures prevent new mutations rather than losing retry keys.

## Checks

```powershell
npm --prefix web run build
npm --prefix web test
```

Install the browser and run browser tests from `web/`:

```powershell
cd web
npx playwright install chromium
npm run test:e2e
```

`build` typechecks and creates `web/dist/`. Six browser tests use labeled fixtures **only in tests**. They cover navigation/filtering/diff escaping, interrupted-response retry across reload, unavailable services, guarded 409 resolution, phone layout/focus, and WCAG checks on overview/modal. There is no production mock/demo mode.

An optional seventh browser test reads a real coordinator. Start an unchanged disposable backend at port 4000, start Vite with `UD_API_TARGET=http://127.0.0.1:4000`, then:

```powershell
$env:UD_REAL_BACKEND='1'
npm --prefix web run test:e2e
```

That test reads health/tasks and confirms named SSE reaches the dashboard. It does not create tasks, approve/apply patches, or certify durable synchronization. Playwright starts Vite if needed, or reuses an existing server; ensure its proxy configuration is correct.

An optional eighth test starts an unchanged real B checkout itself on port 4100. Use a disposable checkout of B's published branch and leave that port free:

```powershell
$env:UD_REAL_LOCAL_ROOT='D:\path\to\disposable-backend-b-checkout'
npm --prefix web run test:e2e
```

It pairs through the UI, queues a real SQLite command with no coordinator configured, kills/restarts B, pairs again, and checks persistent device/receipt identity with one queued command. It stops its own child processes. Pairing-credential traces are disabled. It does not prove remote coordinator delivery. Fixture databases/session files stay inside the disposable checkout's `.frontend-smoke/` directory.

## Delivery and remaining integration

Actual validation on Windows/Node v24.21.0/npm 11.19.0 is recorded in `VERIFICATION.md`. Backend verification used unchanged `ec73ff7` in an ignored disposable checkout. No backend source changes were made.

Actual browser pairing, authenticated local enqueue, and command survival across a real B process restart have been demonstrated. The full three-device MVP remains dependent on A/B: two-device coordinator delivery, dropped remote ACK deduplication, internet-cut/LAN-intact delivery, authorized real conflict resolution, run/cancel/application jobs, and verified Git integration still need joint verification. Fixture tests do not certify those behaviors.

B's device enrollment and coordinator configuration, A's authenticated gateway/run/application routes, registered workspace/test-profile IDs, and separate reviewer authority must be integrated to complete these flows. Backend A/B branches are not assumed merged. Checkpoint recovery and local LLM execution remain future capabilities.
