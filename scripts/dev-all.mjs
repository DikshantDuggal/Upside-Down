import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2),
  options = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (
    [
      "--reviewer",
      "--open",
      "--init-device",
      "--skip-build",
      "--demo-workspace",
    ].includes(key)
  )
    options[key.slice(2)] = true;
  else if (
    [
      "--coordinator-port",
      "--local-port",
      "--web-port",
      "--state-dir",
      "--connect",
      "--device-token-file",
      "--reviewer-token-file",
      "--host",
    ].includes(key) &&
    args[i + 1]
  )
    options[key.slice(2)] = args[++i];
  else throw new Error(`Unknown or incomplete option: ${key}`);
}
if (options.connect) {
  const configured = new URL(options.connect);
  if (
    !["http:", "https:"].includes(configured.protocol) ||
    configured.username ||
    configured.password ||
    configured.pathname !== "/" ||
    configured.search ||
    configured.hash
  )
    throw new Error(
      "--connect requires an explicit HTTP(S) coordinator origin",
    );
}
function fail(message) {
  throw new Error(message);
}
const major = Number(process.versions.node.split(".")[0]),
  minor = Number(process.versions.node.split(".")[1]);
if (major < 24 || (major === 24 && minor < 20))
  fail("Node 24.20+ is required.");
function port(name, fallback) {
  const value = Number(
    options[name] ??
      process.env[
        {
          "coordinator-port": "PORT",
          "local-port": "UD_LOCAL_PORT",
          "web-port": "UD_WEB_PORT",
        }[name]
      ] ??
      fallback,
  );
  if (!Number.isInteger(value) || value < 1 || value > 65535)
    fail(`${name} must be 1..65535`);
  return value;
}
const aPort = port("coordinator-port", 4000),
  bPort = port("local-port", 4100),
  webPort = port("web-port", 5173);
const state = path.resolve(
  options["state-dir"] ??
    path.join(
      process.env.LOCALAPPDATA ?? process.env.XDG_STATE_HOME ?? root,
      "UpsideDown",
      "final-mvp",
    ),
);
const marker = path.join(state, "launch-state.json");
const children = [],
  logs = [];
let host,
  control,
  stopping = false,
  ownsLock = false;
const lockPath = path.join(state, "launch.lock"),
  controlPath = path.join(state, "launch-control.json");
function protect(directory) {
  if (process.platform !== "win32") {
    fs.chmodSync(directory, 0o700);
    return;
  }
  const account = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
  const result = spawnSync(
    "icacls.exe",
    [directory, "/inheritance:r", "/grant:r", `${account}:(OI)(CI)F`],
    { windowsHide: true, stdio: "pipe" },
  );
  if (result.status !== 0)
    fail("Could not protect private launch-state directory with Windows ACLs.");
}
function prepareState() {
  if (
    fs.existsSync(state) &&
    fs.readdirSync(state).length &&
    !fs.existsSync(marker)
  )
    fail(`Refusing to use an unrelated nonempty state directory: ${state}`);
  fs.mkdirSync(state, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(marker)) {
    protect(state);
    fs.writeFileSync(
      marker,
      JSON.stringify({ kind: "upside-down-dev-state", version: 1 }),
      { flag: "wx", mode: 0o600 },
    );
  }
  const check = JSON.parse(fs.readFileSync(marker, "utf8"));
  if (check.kind !== "upside-down-dev-state")
    fail(
      "State marker does not identify a managed Upside-Down development state.",
    );
  const probe = path.join(state, `.write-probe-${randomUUID()}`);
  fs.writeFileSync(probe, "ok", { flag: "wx" });
  fs.unlinkSync(probe);
}
function acquireLock() {
  if (fs.existsSync(lockPath)) {
    const owner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    try {
      process.kill(owner.pid, 0);
      fail(
        "Another launcher owns this state directory. Use npm run stop:all with its --state-dir before restarting.",
      );
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    fs.unlinkSync(lockPath);
  }
  fs.writeFileSync(
    lockPath,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    { flag: "wx", mode: 0o600 },
  );
  ownsLock = true;
}
async function startControl() {
  const pipe =
    process.platform === "win32"
      ? String.raw`\\.\pipe\upside-down-${process.pid}-${randomUUID()}`
      : path.join(state, `control-${process.pid}.sock`);
  const token = randomBytes(32).toString("hex");
  control = net.createServer((socket) => {
    socket.setTimeout(2000, () => socket.destroy());
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk;
      if (data.length > 512) {
        socket.destroy();
        return;
      }
      if (!data.includes("\n")) return;
      try {
        const request = JSON.parse(data);
        if (request.token !== token || request.command !== "stop") {
          socket.destroy();
          return;
        }
        socket.end("stopping\n");
        void shutdown();
      } catch {
        socket.destroy();
      }
    });
  });
  await new Promise((resolve, reject) => {
    control.once("error", reject);
    control.listen(pipe, resolve);
  });
  fs.writeFileSync(
    controlPath,
    JSON.stringify({
      kind: "upside-down-launch-control",
      pid: process.pid,
      pipe,
      token,
      urls: {
        coordinator: options.connect
          ? new URL(options.connect).origin
          : `http://127.0.0.1:${aPort}`,
        local: `http://127.0.0.1:${bPort}`,
        web: `http://127.0.0.1:${webPort}`,
      },
    }),
    { mode: 0o600 },
  );
}
async function free(number) {
  await new Promise((resolve, reject) => {
    const test = net.createServer();
    test.once("error", () =>
      reject(
        new Error(
          `Port ${number} is occupied. Existing processes were left running; choose a different --coordinator-port/--local-port/--web-port or stop your own earlier instance.`,
        ),
      ),
    );
    test.listen(number, "127.0.0.1", () => test.close(resolve));
  });
}
function child(name, script, scriptArgs = [], env = {}) {
  const log = fs.createWriteStream(path.join(state, `${name}.log`), {
    flags: "a",
    mode: 0o600,
  });
  logs.push(log);
  const processChild = spawn(process.execPath, [script, ...scriptArgs], {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.push(processChild);
  for (const stream of [processChild.stdout, processChild.stderr])
    stream.on("data", (chunk) => {
      log.write(chunk);
      process.stdout.write(`[${name}] ${chunk}`);
    });
  processChild.once("error", (error) => {
    console.error(`${name} could not start: ${error.message}`);
    void shutdown(1);
  });
  processChild.once("exit", (code) => {
    if (!stopping && name !== "browser") {
      console.error(
        `${name} stopped unexpectedly (exit ${code}). See ${name}.log in the private state directory.`,
      );
      void shutdown(1);
    }
  });
  return processChild;
}
async function healthy(url, headers, validate) {
  let last;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (stopping) fail("Startup cancelled.");
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(1500),
      });
      if (await validate(response)) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  fail(
    `Service did not become healthy: ${url} (${last}). Inspect private launch logs.`,
  );
}
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  await host?.close();
  if (control) await new Promise((resolve) => control.close(resolve));
  for (const processChild of children.reverse()) {
    if (processChild.exitCode !== null || !processChild.pid) continue;
    const closed = new Promise((resolve) => processChild.once("exit", resolve));
    // Services accept IPC-free SIGTERM; Windows taskkill is limited to our own tracked child tree.
    if (processChild.connected) processChild.send("upside-down:shutdown");
    else processChild.kill("SIGTERM");
    await Promise.race([
      closed,
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
    if (processChild.exitCode === null) {
      if (process.platform === "win32")
        spawnSync(
          "taskkill.exe",
          ["/PID", String(processChild.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
      else processChild.kill("SIGKILL");
    }
  }
  for (const log of logs) log.end();
  if (ownsLock) {
    if (
      fs.existsSync(controlPath) &&
      JSON.parse(fs.readFileSync(controlPath, "utf8")).pid === process.pid
    )
      fs.unlinkSync(controlPath);
    if (
      fs.existsSync(lockPath) &&
      JSON.parse(fs.readFileSync(lockPath, "utf8")).pid === process.pid
    )
      fs.unlinkSync(lockPath);
  }
  console.log("Upside-Down services stopped. Persistent state retained.");
  process.exitCode = code;
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
try {
  for (const relative of [
    "node_modules/express/package.json",
    "web/node_modules/vite/package.json",
  ])
    if (!fs.existsSync(path.join(root, relative)))
      fail(
        `Missing dependencies (${relative}). Run npm install and npm --prefix web ci before launching.`,
      );
  const npmCli =
    process.env.npm_execpath ??
    path.join(
      path.dirname(process.execPath),
      "node_modules/npm/bin/npm-cli.js",
    );
  if (!fs.existsSync(npmCli))
    fail("npm CLI was not found beside Node. Launch using npm run dev:all.");
  const npmVersion = spawnSync(process.execPath, [npmCli, "--version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const npmParts = npmVersion.stdout.trim().split(".").map(Number);
  if (
    npmVersion.status !== 0 ||
    npmParts[0] < 11 ||
    (npmParts[0] === 11 && npmParts[1] < 19)
  )
    fail("npm 11.19+ is required.");
  prepareState();
  const { LocalStore } = await import("../client-local/src/store.ts");
  const localFile = path.join(state, "device.db"),
    local = new LocalStore(localFile),
    deviceId = local.deviceId;
  local.close();
  console.log(`Persistent device: ${deviceId}\nPrivate state: ${state}`);
  if (options["init-device"]) {
    console.log(
      "Device initialized. Have Computer A enroll this UUID, then launch with --connect URL --device-token-file PATH.",
    );
  } else {
    if (
      new Set([bPort, webPort, ...(options.connect ? [] : [aPort])]).size !==
      (options.connect ? 2 : 3)
    )
      fail("Each service needs a distinct port.");
    for (const number of [bPort, webPort, ...(options.connect ? [] : [aPort])])
      await free(number);
    acquireLock();
    await startControl();
    const { FrontendController } =
      await import("../server/core/frontendController.ts");
    const configPath = path.join(state, "frontend.runtime.json"),
      controller = new FrontendController(root, configPath);
    if (!options["skip-build"]) {
      const built = controller.activateTeamFrontend();
      if (!built.success) fail(built.error ?? built.message);
    } else if (!controller.getStatus().htmlExists)
      fail("Selected frontend is not built. Remove --skip-build.");
    const coordinatorOrigin = options.connect
      ? new URL(options.connect).origin
      : `http://127.0.0.1:${aPort}`;
    let tokenPath = options["device-token-file"]
      ? path.resolve(options["device-token-file"])
      : path.join(state, "device.token");
    let reviewerPath = options["reviewer-token-file"]
      ? path.resolve(options["reviewer-token-file"])
      : undefined;
    if (!options.connect) {
      const { CoordinatorDatabase } = await import("../server/db/database.ts");
      const { AuthenticationService } = await import("../server/core/auth.ts");
      const database = new CoordinatorDatabase(
          path.join(state, "coordinator.db"),
        ),
        auth = new AuthenticationService(database);
      try {
        function credential(file, id, role) {
          if (fs.existsSync(file)) {
            const existing = auth.authenticate(
              fs.readFileSync(file, "utf8").trim(),
            );
            if (existing.deviceId !== id || existing.role !== role)
              fail("Configured credential has the wrong role or identity.");
          } else
            fs.writeFileSync(file, auth.enroll(id, role).token + "\n", {
              flag: "wx",
              mode: 0o600,
            });
        }
        credential(tokenPath, deviceId, "device");
        if (options.reviewer) {
          reviewerPath = path.join(state, "reviewer.token");
          const identityPath = path.join(state, "reviewer-id.json");
          if (!fs.existsSync(identityPath))
            fs.writeFileSync(
              identityPath,
              JSON.stringify({ deviceId: randomUUID() }),
              { flag: "wx", mode: 0o600 },
            );
          credential(
            reviewerPath,
            JSON.parse(fs.readFileSync(identityPath, "utf8")).deviceId,
            "reviewer",
          );
        }
      } finally {
        database.close();
      }
      const workspaceConfig = options["demo-workspace"]
        ? (await import("./demo-workspace.mjs")).demoWorkspace(state)
        : (process.env.UD_WORKSPACE_CONFIG ?? "");
      child("coordinator", path.join(root, "server/index.ts"), [], {
        PORT: String(aPort),
        UD_HOST: options.host ?? "127.0.0.1",
        UD_DB_PATH: path.join(state, "coordinator.db"),
        UD_ALLOW_LEGACY: "0",
        UD_PATCH_COMPLETION_MODE: "verified_application",
        UD_AUTO_WATCH: "false",
        UD_WORKSPACE_CONFIG: workspaceConfig,
        UD_FRONTEND_CONFIG: configPath,
      });
    }
    if (!fs.existsSync(tokenPath))
      fail(
        "Device token file is missing. Computer A must enroll this persistent device UUID.",
      );
    const token = fs.readFileSync(tokenPath, "utf8").trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      fail(
        "Device token file must contain the raw enrolled bearer credential.",
      );
    const authenticated = {
      Authorization: `Bearer ${token}`,
      "X-UD-Contract": "UD-IC/1.0",
    };
    await healthy(
      coordinatorOrigin + "/api/capabilities",
      authenticated,
      async (response) =>
        response.ok && (await response.json()).contractVersion === "UD-IC/1.0",
    );
    child("local-service", path.join(root, "scripts/local-service.mjs"), [], {
      UD_DEVICE_DB: localFile,
      UD_LOCAL_PORT: String(bPort),
      UD_COORDINATOR_URL: coordinatorOrigin,
      UD_DEVICE_TOKEN_FILE: tokenPath,
      UD_REVIEWER_TOKEN_FILE: reviewerPath ?? "",
      UD_ALLOWED_ORIGINS: `http://127.0.0.1:${webPort}`,
    });
    const localOrigin = `http://127.0.0.1:${bPort}`;
    await healthy(
      localOrigin + "/local/session",
      { "X-UD-Contract": "UD-IC/1.0" },
      async (response) => response.status === 401,
    );
    const pairingKey = JSON.parse(
      fs.readFileSync(localFile + ".session.json", "utf8"),
    ).pairingKey;
    const paired = await fetch(localOrigin + "/local/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-UD-Contract": "UD-IC/1.0",
        Origin: `http://127.0.0.1:${webPort}`,
      },
      body: JSON.stringify({ pairingKey }),
    });
    if (paired.status !== 200)
      fail("Local browser pairing health check failed.");
    const cookie = paired.headers.get("set-cookie").split(";")[0];
    await healthy(
      localOrigin + "/local/health",
      { "X-UD-Contract": "UD-IC/1.0", Cookie: cookie },
      async (response) =>
        response.ok && (await response.json()).coordinatorReachable === true,
    );
    const { startWebHost } = await import("./web-host.mjs");
    host = await startWebHost({ port: webPort, localOrigin, configPath });
    await healthy(
      `http://127.0.0.1:${webPort}`,
      {},
      async (response) =>
        response.ok && (await response.text()).includes('<div id="root">'),
    );
    console.log(
      `\nREADY: official frontend http://127.0.0.1:${webPort}\nCoordinator: ${coordinatorOrigin} (authenticated)\nLocal service: ${localOrigin} (paired session required)\nPair using the pairingKey field in ${localFile}.session.json\nStop with Ctrl+C. Restart with the same command; state persists.`,
    );
    if (options.open)
      child("browser", path.join(root, "scripts/open-browser.mjs"), [
        state,
        `http://127.0.0.1:${webPort}`,
      ]);
  }
} catch (error) {
  console.error(`Launch failed: ${error.message}`);
  await shutdown(1);
}
