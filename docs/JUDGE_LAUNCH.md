# Local judging prototype

Open http://127.0.0.1:5180. Dedicated loopback coordinator:4050.

Launch from PowerShell:

    & 'C:\Users\diksh\OneDrive\Documents\ChatGPT\bruh\Upside-Down\scripts\start-judge.ps1'

Or run npm run judge from the repository. Build missing assets with
npm --prefix web run build. State persists in .board/judge-runtime/mission.db.
Both ports are one process; legacy4000/5173 launchers do not replace this instance.

90-second walkthrough:
1. Mission Control shows the existing local project.
2. AI Idea Studio: generate concepts, inspect one, select it.
3. Inspect the architecture/API contracts and approve the architecture.
4. Work Contracts (2.0): inspect4 actual persisted tasks and export coding-tool prompts.
5. Team & Tools / Agent Handoffs: demonstrate local collaboration metadata.
6. Refresh to show persistence. Use manual prompt handoffs with actual coding tools.

Observed 4 November 2026:
- npm run test:hackathon:32 PASS (11 engine +21 HTTP).
- npm --prefix web run build:PASS (TypeScript +Vite).
- Actual Chromium: generate ideas, select, approve architecture, display4 contracts;
  zero browser runtime errors. Screenshot .board/judge-runtime/judge.png.
- Live SSE mutation regression fixed: use real durable coordinator publish API;
  events persist even when no browser is subscribed.
- Architecture versions increase; repeated task generation preserves existing work;
  new task IDs/dependencies are scoped per project to prevent cross-project overwrite.
- Removed fabricated PR42, build/test passes and hosted-deployment success.

Limits: local heuristic planning, manual coding-tool prompts, developer-reported
progress/evidence. Direct external AI execution, verified GitHub/CI, independent
host/member authentication and public deployment are incomplete. The local banner
states this explicitly. Do not present older hosted/verified UI text as proven.

Root npm run typecheck:FAIL on existing cross-baseline backend types/storage and
legacy tests. Full clean install/legacy-suite rerun was not completed for the urgent
launch. Existing dependencies used; no fabricated test or deployment claims.
Local verified planning demo:GO. Public production deployment:NOT READY.
Existing LAN peer device database/token and recurring monitor remain untouched.
