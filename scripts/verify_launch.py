import subprocess
import time
import urllib.request
import json
import sys

proc = subprocess.Popen(
    ["node", "--experimental-strip-types", "server/index.ts"],
    cwd=r"C:\Users\diksh\.gemini\antigravity\scratch\Upside-Down-Proto-G",
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True
)

time.sleep(2)

try:
    with urllib.request.urlopen("http://localhost:4000/api/health") as res:
        health = json.loads(res.read().decode())
        print(f"Health check: {health}")

    with urllib.request.urlopen("http://localhost:4000/api/sync/status") as res:
        sync_status = json.loads(res.read().decode())
        print(f"Sync status: {sync_status}")

    with urllib.request.urlopen("http://localhost:4000/") as res:
        html = res.read().decode()
        print(f"Dashboard loaded: {len(html)} bytes, status {res.status}")

    with urllib.request.urlopen("http://localhost:4000/api/agents") as res:
        agents = json.loads(res.read().decode())
        print(f"Registered agents: {len(agents)} agents online")

    print("\n>>> LOCAL LAUNCH VERIFICATION: 100% SUCCESSFUL <<<")
finally:
    proc.terminate()
    proc.wait()
