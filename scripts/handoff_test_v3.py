import os
import sys
import json
import time
import secrets
import subprocess
from datetime import datetime, timezone

REPO_ROOT = r"C:\Users\diksh\.gemini\antigravity\scratch\Upside-Down-Proto-G"
BOARD_REPO = "DikshantDuggal/Upside-Down"
BOARD_ISSUE = "1"
INTENDED_RECIPIENT = "ArhaanArora"
BASH_EXE = r"C:\Program Files\Git\bin\bash.exe"
BOARD_SH = os.path.join(REPO_ROOT, ".board", "board.sh")
CURSOR_FILE = os.path.join(REPO_ROOT, ".board", "cursor-DikshantDuggal_Upside-Down-1")

results = {
    "checks": {},
    "metadata": {}
}

def run_cmd(cmd, input_text=None, cwd=REPO_ROOT):
    p = subprocess.run(
        cmd,
        input=input_text,
        text=True,
        capture_output=True,
        cwd=cwd
    )
    return p.returncode, p.stdout.strip(), p.stderr.strip()

print("=== PROTOCOL 3.0: AGENT COMMUNICATION VERIFICATION ===")

# 1. Identity check
code, stdout, stderr = run_cmd(["gh", "api", "user", "--jq", ".login"])
if code != 0 or not stdout:
    print(f"Error checking gh user: {stderr}")
    sys.exit(1)
sender_login = stdout.strip()
print(f"SENDER_LOGIN: {sender_login}")
results["checks"]["github_authenticated"] = (sender_login == "DikshantDuggal")
results["metadata"]["sender_login"] = sender_login

# 2. Launcher check
code, stdout, stderr = run_cmd([BASH_EXE, BOARD_SH, "whoami"])
print(f"Launcher whoami: {stdout}")
results["checks"]["launcher_functional"] = (code == 0 and stdout == sender_login)

# 3. Cursor state
cursor_before = None
if os.path.exists(CURSOR_FILE):
    with open(CURSOR_FILE, "r") as f:
        cursor_before = f.read().strip()
print(f"Cursor before: {cursor_before}")

# 4. Generate unique Test-ID
now_local = datetime.now()
random_suffix = secrets.token_hex(2).upper()
test_id = f"PROTO3-{now_local.strftime('%Y%m%d-%H%M%S')}-{random_suffix}"
print(f"Generated Test-ID: {test_id}")
results["metadata"]["test_id"] = test_id

# 5. Check duplicate
code, stdout, stderr = run_cmd(["gh", "api", f"repos/{BOARD_REPO}/issues/{BOARD_ISSUE}/comments?per_page=100", "--jq", ".[].body"])
if test_id in stdout:
    print("Duplicate Test-ID detected! Aborting.")
    sys.exit(1)

# 6. Compose and post
message_body = f"""[{sender_login}'s Codex] @{INTENDED_RECIPIENT} HANDOFF-TEST: please acknowledge.

Protocol: UPSIDE-DOWN/HANDOFF-TEST
Version: 3.0
Test-ID: {test_id}
Branch: dikshat/backend-proto-g
Expected-ACK: HANDOFF-ACK"""

post_time_local = datetime.now()
code, stdout, stderr = run_cmd([BASH_EXE, BOARD_SH, "post"], input_text=message_body)
print(f"Post returncode: {code}")
print(f"Post output: {stdout}")
if stderr:
    print(f"Post stderr: {stderr}")

if code != 0 or not stdout.startswith("http"):
    print("Posting failed!")
    sys.exit(1)

request_comment_url = stdout.strip()
results["checks"]["message_posted"] = True
results["metadata"]["request_comment_url"] = request_comment_url
results["metadata"]["post_time_local"] = post_time_local.isoformat()

# 7. Verify outbound retrieval
time.sleep(2)
code, stdout, stderr = run_cmd([
    "gh", "api", f"repos/{BOARD_REPO}/issues/{BOARD_ISSUE}/comments?per_page=100",
    "--jq", ".[] | {id: .id, url: .html_url, user: .user.login, body: .body, created_at: .created_at}"
])

outbound_valid = False
if code == 0 and stdout:
    for line in stdout.strip().split("\n"):
        if not line.strip():
            continue
        try:
            c = json.loads(line)
            if test_id in c['body']:
                outbound_valid = (c['user'].lower() == sender_login.lower() and f"@{INTENDED_RECIPIENT}" in c['body'])
                print(f"Outbound comment verified: ID {c['id']} by @{c['user']}")
                results["metadata"]["outbound_comment_id"] = c['id']
                results["metadata"]["outbound_created_at"] = c['created_at']
                break
        except Exception:
            continue

results["checks"]["message_retrieved"] = outbound_valid

# 8. Bounded 60-second ACK check
ack_found = False
ack_comment_data = None
start_wait = time.time()
max_wait = 60
poll_interval = 6

while time.time() - start_wait < max_wait:
    elapsed = int(time.time() - start_wait)
    print(f"Polling for ACK... elapsed {elapsed}s / {max_wait}s")
    
    code, stdout, stderr = run_cmd([
        "gh", "api", f"repos/{BOARD_REPO}/issues/{BOARD_ISSUE}/comments?per_page=100",
        "--jq", ".[] | {id: .id, url: .html_url, user: .user.login, body: .body, created_at: .created_at}"
    ])
    
    if code == 0 and stdout:
        for line in stdout.strip().split("\n"):
            if not line.strip():
                continue
            try:
                c = json.loads(line)
                if c['user'].lower() == INTENDED_RECIPIENT.lower():
                    if test_id in c['body'] and "HANDOFF-ACK" in c['body']:
                        ack_found = True
                        ack_comment_data = c
                        print(f"\n>>> MATCHING ACK FOUND from @{c['user']}! <<<")
                        break
            except Exception:
                continue
        if ack_found:
            break
            
    time.sleep(poll_interval)

results["metadata"]["observed_waiting_duration"] = int(time.time() - start_wait)
results["checks"]["bounded_wait_completed"] = True

cursor_after = None
if os.path.exists(CURSOR_FILE):
    with open(CURSOR_FILE, "r") as f:
        cursor_after = f.read().strip()
results["checks"]["cursor_safety_maintained"] = (cursor_before == cursor_after)

if ack_found:
    results["checks"]["recipient_ack_detected"] = "PASS"
    results["checks"]["ack_author_verified"] = "PASS"
    results["checks"]["test_id_matched"] = "PASS"
    results["metadata"]["ack_comment_url"] = ack_comment_data['url']
    results["status"] = "PASS"
else:
    results["checks"]["recipient_ack_detected"] = "PENDING"
    results["checks"]["ack_author_verified"] = "PENDING"
    results["checks"]["test_id_matched"] = "PENDING"
    results["metadata"]["ack_comment_url"] = "None (Awaiting cross-account acknowledgment)"
    results["status"] = "PENDING — Awaiting cross-account acknowledgment"

out_file = os.path.join(REPO_ROOT, ".board", "handoff_proto3_results.json")
with open(out_file, "w") as f:
    json.dump(results, f, indent=2)

print("\n--- Protocol 3.0 Handoff Results ---")
print(json.dumps(results, indent=2))
