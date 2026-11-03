# Hackathon quick launch

From `PS C:\Users\diksh>`:

```powershell
.\Start-UpsideDown.ps1
# Stop/restart with persistent state:
.\Start-UpsideDown.ps1 -Stop
.\Start-UpsideDown.ps1
```

Official UI: http://127.0.0.1:5175. B local service: 4110. Authenticated A: 4001.
The home wrapper reuses a running managed instance, or launches the official app
with separate reviewer credentials and a marked disposable Git repair fixture.

From another release checkout: `npm ci`, `npm --prefix web ci`, then
`npm run dev:all -- --coordinator-port 4001 --local-port 4110 --web-port 5175 --reviewer --demo-workspace --open`.
No unrelated port owner is stopped. Chromium installation is required for `--open`.

[Full setup/troubleshooting](FINAL_LAUNCH_GUIDE.md) ·
[Demo walkthrough](HACKATHON_DEMO_GUIDE.md) ·
[Computer B onboarding](TWO_COMPUTER_SETUP.md) ·
[Actual evidence and limits](LAUNCH_ACCEPTANCE_REPORT.md).

Physical Computer B testing is pending. Recurring GitHub coordination stays disabled.
