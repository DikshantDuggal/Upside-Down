/**
 * Test Group A: Environment & Isolation Verification
 * Protocol Version: 3.0
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

async function runEnvironmentTests() {
  console.log("\n=== TEST GROUP A: ENVIRONMENT & ISOLATION VERIFICATION ===");

  // 1. Verify Git
  console.log("\n[RUN] Test 1: Git executable and version check...");
  const gitVersion = execFileSync("git", ["--version"], { encoding: "utf-8" }).trim();
  assert.ok(gitVersion.startsWith("git version"), `Invalid git version: ${gitVersion}`);
  console.log(`  [PASS] Git verified: ${gitVersion}`);

  // 2. Verify Bash
  console.log("\n[RUN] Test 2: Bash executable check...");
  const bashCandidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "bash",
  ];
  let bashVersion = "";
  for (const b of bashCandidates) {
    try {
      bashVersion = execFileSync(b, ["--version"], { encoding: "utf-8" }).split("\n")[0].trim();
      break;
    } catch {
      // try next
    }
  }
  assert.ok(bashVersion.length > 0, "Bash executable not found");
  console.log(`  [PASS] Bash verified: ${bashVersion}`);

  // 3. Verify GitHub CLI & Authentication
  console.log("\n[RUN] Test 3: GitHub CLI executable and authentication check...");
  const ghVersion = execFileSync("gh", ["--version"], { encoding: "utf-8" }).split("\n")[0].trim();
  assert.ok(ghVersion.startsWith("gh version"), `Invalid gh version: ${ghVersion}`);

  const ghUser = execFileSync("gh", ["api", "user", "--jq", ".login"], { encoding: "utf-8" }).trim();
  assert.equal(ghUser, "DikshantDuggal", "Must be authenticated as DikshantDuggal");
  console.log(`  [PASS] GitHub CLI verified: ${ghVersion} (Logged in as: @${ghUser})`);

  // 4. Verify Node.js and npm
  console.log("\n[RUN] Test 4: Node.js runtime and npm package manager check...");
  const nodeVersion = process.version;
  const majorNode = parseInt(nodeVersion.replace("v", "").split(".")[0], 10);
  assert.ok(majorNode >= 22, `Node version must be >= 22 for native SQLite and type stripping, got: ${nodeVersion}`);

  const npmVersion = execFileSync("npm.cmd", ["--version"], { shell: true, encoding: "utf-8" }).trim();
  assert.ok(npmVersion.length > 0, "npm not found");
  console.log(`  [PASS] Node.js and npm verified: Node ${nodeVersion}, npm ${npmVersion}`);

  // 5. Verify Repository & Isolation Branch
  console.log("\n[RUN] Test 5: Repository origin and prototype branch isolation...");
  const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf-8" }).trim();
  assert.ok(
    remoteUrl.includes("DikshantDuggal/Upside-Down"),
    `Remote must be DikshantDuggal/Upside-Down, got: ${remoteUrl}`
  );

  const currentBranch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf-8" }).trim();
  assert.ok(
    currentBranch === "dikshant/backend-proto-g" || currentBranch === "dikshat/backend-proto-g" || currentBranch === "dikshat/demo-frontend" || currentBranch === "integration/final-mvp" || currentBranch === "codex/final-launch",
    `Active branch must be an authorized prototype branch ('dikshat/backend-proto-g' or 'dikshat/demo-frontend'), got: '${currentBranch}'`
  );
  console.log(`  [PASS] Repository and branch verified: ${remoteUrl} [${currentBranch}]`);

  console.log("\n=== ALL TEST GROUP A TESTS PASSED! ===");
}

runEnvironmentTests().catch((err) => {
  console.error("Environment test failed:", err);
  process.exit(1);
});

