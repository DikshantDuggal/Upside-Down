# GitHub communication: implemented Phase5 architecture

GitHub Issues and issue comments are the authoritative communication ledger.
The existing application backend handles planning and the dashboard. The optional
standalone agent bridge needs Node24.20+ and authenticated `gh`, without an app
server, LAN configuration, another message service, or direct agent connections.

## Connect and start a mission

1. Authenticate the host's own GitHub CLI (`gh auth login`). Do not share its token.
2. Approve the existing project architecture and generate its task contracts.
3. Open **Agent Communication Center** in Upside-Down.
4. Pair the host browser with the protected dashboard key in
   `%LOCALAPPDATA%/UpsideDown/github-coordination/dashboard.key`.
   The key is an application session secret, not a GitHub token. Do not post it.
5. Expand Connect repository, enter an existing authorized `owner/repo`, and provide
   developer login/role/tool JSON. GitHub validates identities and assignability;
   the host needs repository write permission and enabled issues.
6. Connect/start: create/reconcile one coordinator issue and a task issue for every
   contract. No developer receipt is assumed until that account posts TASK_ACK.

The host-authored immutable bootstrap comment contains the versioned project,
architecture, participant numeric GitHub IDs and contracts. Task issue bodies carry
stable project/task markers and human-readable manual prompts; titles alone never
establish identity or ownership. Labels are `ud-coordination` and `ud-task`.
GitHub issue assignees and host-authorized assignment messages identify ownership.
Reassignment preserves the task issue and changes the explicit branch/owner revision.

## Verification and routing

`server/core/github/protocol.ts` validates strict UD-IC/2.0 envelopes and payloads.
GitHub API comment authorship (`user.id` plus login) is checked independently of the
sender text. This is API provenance verification, not a custom cryptographic
signature on every comment. Webhook bodies separately use GitHub HMAC-SHA256.

Only the verified host may assign/reassign work, update contracts, request CI or
approve/reject submissions. Developers may update their own current assignment.
Stale assignment IDs, unknown correlations, wrong recipients and unauthorized
senders are rejected and audited. A completion report becomes **submitted**.
**Verified** requires current PR author/branch/base/SHA, allowed/protected file
checks (including renamed paths), actual CI, and exact-SHA host approval.
No PR number, successful test output, tool execution or deployment is fabricated.

Handoffs are correlated request -> ACK -> response -> requester completion, with
optional host contract approval. Responses may use either participating task's
issue context. Missing ACKs stay pending/overdue for host intervention. The reducer
never auto-replies, runs issue instructions or starts coding agents.

## Persistence and recovery

The protected native SQLite cache stores remote pages/ETags, messages, outbound
intents, checkpoints and cursor leases. Every completed synchronization reads the
coordinator and authorized task issues, validates them and atomically commits the
snapshot/checkpoint. Full replay rebuilds the cache after restart or attach.
A failed network/authentication/pagination pass never advances the checkpoint.
The cache is not an alternative message authority.

Conditional GitHub GETs and paginated reads are bounded (20pages per collection).
Transient reads use bounded exponential backoff and honor rate-limit retry time;
long rate limits return a retry requirement. Writes are never blindly retried:
unknown outcomes retain the exact ID/body and reconcile remote comments first.
SQLite leases serialize consumers. No tools/board unread/wait/hook cursor or native
scheduled monitor is consumed, enabled or modified.

Edited structured comments are quarantined. Deleted source comments disappear
from the rebuilt projection and are reported; previous derived completion is not
silently retained without its evidence. Host bootstrap edits/deletion require
explicit human repair. Publish a new correlated message instead of editing one.

## Dashboard authentication and delivery

Host sessions use HttpOnly, SameSite=Strict cookies, CSRF and an allowed-Origin
check. GitHub credentials stay in `gh`/the server environment. Browser storage may
contain only unresolved message intent data; pairing/CSRF secrets are not stored.
The dashboard shows GitHub task links, actor/tool reports, correlated handoffs,
validated source-comment timeline, PR/check facts and validation audit.
Existing local-only mutation routes reject GitHub-managed missions; communication
is routed to the GitHub center. Older offline features are preserved for unrelated
legacy workspaces; no new local agent transport was added.

An optional `/api/github/webhook` verifies the **raw** HMAC signature, deduplicates
both delivery ID and body hash, then re-fetches canonical GitHub state. No public
receiver/webhook registration was deployed in this session. Use explicit Refresh
or the bounded CLI poll fallback. A native scheduled monitor remains paused.

GitHub API contracts: [issue comments](https://docs.github.com/en/rest/issues/comments),
[webhook signatures](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).
See `AGENT_BRIDGE.md`, `UD_IC_2_PROTOCOL.md` and `MULTI_AGENT_TEST.md` for exact commands
and the separation between actual GitHub results and fixture-only multi-identity tests.
