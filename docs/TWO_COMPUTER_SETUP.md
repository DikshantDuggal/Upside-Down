# Computer A and Computer B setup

Status: local independent-device HTTP replication is tested; **physical Computer B
was unavailable**. No physical LAN success is claimed.

Both computers need the same reviewed release source, Node 24.20+, npm 11.19+
and installed dependencies. Keep each SQLite file on its own local disk; never
copy one device DB/token to another computer or share a live DB over SMB.

## Computer B: initialize persistent identity

On Arhaan's machine, from its release checkout:

```powershell
npm ci
npm --prefix web ci
npm run device:init -- --state-dir E:\UpsidePrivate\device-b
```

Send A only the printed UUID. This creates no reviewer role and prints no secret.
The actual state path is local to B; select one that B controls.

## Computer A: enroll that UUID

With the coordinator DB used by the managed A instance:

```powershell
npm run enroll -- --db "$env:LOCALAPPDATA\UpsideDown\final-mvp\coordinator.db" --device DEVICE_UUID_FROM_B --role device --out "$env:LOCALAPPDATA\UpsideDown\device-b.token"
```

Replace `DEVICE_UUID_FROM_B` with B's printed UUID. Transfer the protected raw token
file through your trusted local setup; never use GitHub, browser storage or chat.
Enrollment prints a nonsecret principal ID for later revocation. Revoke using
`npm run enroll -- --db ABSOLUTE_A_DB --revoke PRINCIPAL_ID`.

## A: explicitly enable private LAN binding

Stop A's managed stack first. Determine A's actual private LAN address:

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }
npm run dev:all -- --coordinator-port 4001 --host 0.0.0.0 --reviewer --demo-workspace
```

Binding alone does not change the firewall. If a rule is required, a human should
add a narrowly scoped inbound TCP 4001 rule for the PRIVATE profile and B's actual
LAN IP using Windows Defender Firewall. This task created no firewall rule and
never disables the firewall or forwards the port to the internet.

## B: connect and launch its own official UI

```powershell
Test-NetConnection COMPUTER_A_LAN_IP -Port 4001
npm run dev:peer -- --state-dir E:\UpsidePrivate\device-b --connect http://COMPUTER_A_LAN_IP:4001 --device-token-file E:\UpsidePrivate\device-b.token --local-port 4100 --web-port 5173
```

Replace `COMPUTER_A_LAN_IP` with the actual address; no address is hardcoded.
This starts only B's local service/UI, not another authority. Open
http://127.0.0.1:5173 and pair using B's own `device.db.session.json` pairingKey.
Normal pairing remains unprivileged. A separately enrolled reviewer requires a
DIFFERENT token and `--reviewer-token-file`; never reuse the sync token.

## Physical acceptance procedure

1. A and B verify distinct printed UUIDs and separate DB paths.
2. Create a task/message on B; A and both UIs must see one authoritative result.
3. Disconnect B from A while leaving B's local service/UI running. Queue a task.
4. Restart B with the same state, re-pair, and confirm the pending receipt persists.
5. Reconnect; confirm delivery, no duplicate task and both interfaces converge.
6. Submit a stale proposal; confirm a visible conflict, then use an actual enrolled
   reviewer to resolve against current revisions.
7. Disconnect internet while retaining LAN; repeat task/message delivery.
8. Inspect actual commit/test evidence from an approved isolated patch application.

Record real machine names, addresses, device UUIDs, outcomes and timestamps without
tokens. Until this procedure runs on separate computers, TWO-COMPUTER DEMO READY
remains NOT TESTED. Automatic AI handoffs require separate actual agent execution;
scripted transport acknowledgements do not establish autonomous AI work.
