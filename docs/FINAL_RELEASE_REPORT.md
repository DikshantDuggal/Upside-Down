# Final release engineering report

Release branch: `codex/final-launch`, derived from required `integration/final-mvp`.
See `.board/evidence/final-release.json` for the exact final local commit/tree and
[acceptance evidence](LAUNCH_ACCEPTANCE_REPORT.md) for actual commands and results.
The original dirty checkout and all existing branches/data are preserved.
No automatic remote push/merge or public deployment was performed.

**LOCAL DEMO READY: GO** for the actual official frontend, authenticated local/A
services, durable task/message sync, projects, device-owned assignments/handoffs,
recipient ACK, conflicts, replay and safe reviewer code application.
**SIMULATED TWO-DEVICE: PASS** means real independent local DBs/services/browser
sessions on one computer, not fake HTTP outcomes or physical-machine proof.
**PHYSICAL TWO-COMPUTER: NOT TESTED**, pending trusted transfer of the newly issued
remote device token and actual authenticated LAN/offline rehearsal.
**PRODUCTION: NOT ASSESSED / NOT AUTHORIZED**.

Start from home: `.\Start-UpsideDown.ps1`; stop with `-Stop`.
This verified release uses UI5175/B4110/A4001 to coexist with the original stack.
The LAN wrapper is `.\Start-UpsideDown-LAN.ps1`, local4111/UI5176; it requires the
fresh remote-issued token in the protected LAN state directory.

The official `web/` remains primary, the old demo is preserved and clearly read-only,
and actual browser rollback retains real task data. Persistent state uses protected
per-installation directories; no DB is reset for tests. A new demo creates fresh
marked state and preserves old records. Execution targets only registered disposable
fixtures or explicitly configured trusted workspaces. No unassigned real repository
implementation, automatic PR merge, actual LLM/failover or autonomous-agent claim
is made. Recurring GitHub monitoring remains disabled.

[Full guide](FINAL_LAUNCH_GUIDE.md) · [Demo walkthrough](HACKATHON_DEMO_GUIDE.md) ·
[Computer B onboarding](TWO_COMPUTER_SETUP.md) · [Integration matrix](FINAL_INTEGRATION_REPORT.md).
