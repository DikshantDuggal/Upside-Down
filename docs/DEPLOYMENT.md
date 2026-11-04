# Deployment and local launch

Phase5 has been built and run locally. No public deployment or live public
webhook was configured or verified. Older hosting examples are not proof of a
working deployment. Full repository TypeScript validation and the legacy static
frontend test still have failures; see PHASE5_VERIFICATION.md.

## Verified local judging path

From Windows PowerShell:

```powershell
Set-Location 'C:\Users\diksh\OneDrive\Documents\ChatGPT\bruh\Upside-Down'
npm --prefix web run build
npm run judge
```

Open http://127.0.0.1:5180 and select Agent Communication Center. If the dedicated
judge host is already running the launcher prints its existing URL and exits;
it does not start another instance or erase the persisted mission database.
Port5180 serves the real production web build and proxies application APIs to
loopback4050. These are same-laptop UI/API endpoints, not agent communication
transports. Each developer's bridge talks independently to GitHub.

The GitHub host must have `gh` installed/authenticated. Pair the host dashboard
with the locally protected `%LOCALAPPDATA%\UpsideDown\github-coordination\dashboard.key`.
Never send that key to a teammate or issue. Credentials remain server-side.
Use an existing approved mission or attach dedicated coordinator issue15 for the
recorded acceptance fixture. Creating another mission writes real GitHub issues.

## Reproducible builds

Requires Node24.20+ (native SQLite/type stripping), npm and GitHub CLI. A fresh
checkout needs `npm ci` and `npm --prefix web ci`; this verification used the
existing installed dependencies, not a fresh clean installation.

```powershell
npm run typecheck:github
npm run test:github
npm --prefix web test -- --run
npm --prefix web run build
npm run build:server
npm run start:production
```

The explicit production entry is server/start.ts, bundled to dist/server.mjs.
Default bind is loopback4050. Configure PORT and UD_HOST for an authorized host;
make database parent directories before startup. Browser assets are web/dist:
a production reverse proxy/static host must serve those assets and route `/api/`
to the backend on the same browser origin, including streaming/timeouts.
The root server's legacy frontend activation is a separate mechanism; the
verified local judging script directly serves web/dist.

## Public hosting configuration still required

- Long-running Node24.20+ service with persistent SQLite volumes and GitHub CLI
  installed. The service account needs authorized issue/PR/check permissions;
  an optional configured workflow also needs Actions dispatch permission.
- Persistent `UD_DB_PATH` and `UD_GITHUB_STATE_DIR`; protect the latter directory
  and its dashboard key/outbox/cache. Use host-managed secrets or gh credential
  storage. Never place tokens in frontend VITE variables or tracked files.
- `UD_GITHUB_ALLOWED_ORIGINS` containing the exact authorized HTTPS browser origin.
  `UD_ALLOWED_ORIGINS` configures legacy application CORS separately. Use a
  same-origin HTTPS proxy for `/api/github`; cookies are HttpOnly/SameSiteStrict
  and HTTPS-origin sessions receive Secure cookies.
- Optional `UD_GITHUB_WEBHOOK_SECRET` plus public HTTPS `/api/github/webhook`.
  Configure relevant issue/comment/PR/push/check events in GitHub, validate actual
  deliveries and handle retry requirements. The raw HMAC/dedup path is locally
  tested; public delivery is unverified.
- Observe real CI on authorized task branches. `not_configured` blocks verified
  submission approval. Start-checks needs a named active workflow in the workspace.

This MVP uses a host-controlled GitHub CLI credential rather than GitHub App
OAuth/installations. Multi-tenant authorization, deployment hardening and GitHub
App lifecycle are future work. Coding-tool integrations are manual prompts/CLI,
not direct proprietary assistant APIs. Native scheduled board monitoring remains
paused; explicit Refresh and bounded bridge polls work without it.
