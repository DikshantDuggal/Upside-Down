# Frontend activation and rollback handoff

The official frontend is `web/`, built by its own TypeScript/Vite scripts. Root
`build:team` delegates to that package. The obsolete `frontend/` prototype remains
preserved. `apps/demo-frontend/` is a read-only fallback with real task/agent/activity
reads and disabled legacy mutations; it does not imply autonomous AI execution.

```powershell
npm run frontend:status
npm run frontend:activate
npm run build:demo
npm run frontend:rollback
npm run frontend:activate
```

For custom launch state, append `-- --state-dir YOUR_STATE`. Default state matches
the normal launcher: `%LOCALAPPDATA%\UpsideDown\final-mvp`. The home launcher uses
UI5175/local4110/A4001 to coexist with the already-running original checkout.

Activation validates a real official TypeScript/Vite build and its referenced
assets before selecting it. The web host serves that selection on subsequent page
loads. Frontend selection affects neither SQLite domain data nor credentials.
A failed candidate leaves the previous selection intact. Windows redirected-profile
EXDEV is handled for selection metadata only. Rollback requires actual demo assets.

Isolated HTTP and browser checks verify official -> read-only demo -> official,
with the same real task retrieved through an authenticated local service. Evidence:
`.board/evidence/live-rollback.json`, `launch.log`.

The user explicitly approved narrow project/handoff views and B-proxy compatibility
in this chat (board #6617052077). Those screens preserve the existing official design.
Canonical offline commands are unchanged; project/handoff writes are online-only.
See `FINAL_LAUNCH_GUIDE.md` and `LAUNCH_ACCEPTANCE_REPORT.md` for commands and results.
