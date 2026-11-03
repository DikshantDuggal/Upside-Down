"""Run actual authenticated browser acceptance against an already running managed stack."""
from pathlib import Path
import subprocess
root = Path(__file__).resolve().parent.parent
subprocess.run(["node", str(root / "scripts" / "test-launch-browser.mjs")], cwd=root, check=True)
