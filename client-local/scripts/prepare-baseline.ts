// A read-only compatibility fixture. This does not merge or approve Backend A's branch.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const sha = "ec73ff7b1fcc16645484709ea92c51d9dfc46068";
for (const file of ["contracts/task.ts", "contracts/events.ts", "contracts/agent.ts", "server/db/database.ts"]) {
  const body = execFileSync("git", ["show", `${sha}:${file}`], { cwd: root, encoding: "utf8" });
  const dest = resolve(root, "client-local/.integration/backend", file);
  mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, body);
}
console.log(`Checking against read-only Backend A type fixture ${sha}`);
