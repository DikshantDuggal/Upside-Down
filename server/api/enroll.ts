import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { CoordinatorDatabase } from "../db/database.ts";
import { AuthenticationService } from "../core/auth.ts";

const { values } = parseArgs({ options: { db: { type: "string" }, device: { type: "string" }, role: { type: "string", default: "device" },
  out: { type: "string" }, revoke: { type: "string" } }, strict: true });
if (!values.db || !path.isAbsolute(values.db)) throw new Error("--db requires an absolute coordinator database path");
if (values.revoke) {
  const db = new CoordinatorDatabase(values.db);
  try { new AuthenticationService(db).revoke(values.revoke); console.log("Credential revocation recorded."); }
  finally { db.close(); }
} else {
  if (!values.device || !values.out || !path.isAbsolute(values.out)) throw new Error("--device and absolute --out are required");
  const out = values.out;
  fs.mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
  // Exclusive creation preserves an existing credential file. Only hashes go in DB.
  const fd = fs.openSync(out, "wx", 0o600);
  let db: CoordinatorDatabase | undefined;
  let enrollment: ReturnType<AuthenticationService["enroll"]> | undefined;
  try {
    if (process.platform === "win32") {
      const account = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
      const permissions = spawnSync("icacls.exe", [out, "/inheritance:r", "/grant:r", `${account}:(R,W)`], { windowsHide: true, encoding: "utf8" });
      if (permissions.status !== 0) throw new Error("Could not restrict credential file permissions");
    }
    db = new CoordinatorDatabase(values.db);
    const auth = new AuthenticationService(db);
    enrollment = auth.enroll(values.device, values.role as "device" | "reviewer" | "admin");
    fs.writeFileSync(fd, enrollment.token + "\n", "utf8");
    fs.fsyncSync(fd);
    console.log(`Enrollment complete. Principal ${enrollment.principal.id}; device ${enrollment.principal.deviceId}; role ${enrollment.principal.role}. Credential saved to the protected file; token was not printed.`);
  } catch {
    if (db && enrollment) new AuthenticationService(db).revoke(enrollment.principal.id);
    throw new Error("Enrollment did not complete; inspect the protected output file before retrying");
  } finally { fs.closeSync(fd); db?.close(); }
}
