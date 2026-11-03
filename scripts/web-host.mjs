import { createServer, request as proxyRequest } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FrontendController } from "../server/core/frontendController.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export async function startWebHost({ port, localOrigin, configPath }) {
  const controller = new FrontendController(root, configPath);
  const upstream = new URL(localOrigin);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(upstream.hostname))
    throw new Error("Browser proxy must target a loopback local service");
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".json": "application/json",
  };
  const sockets = new Set();
  const server = createServer((req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.url?.startsWith("/api/") || req.url?.startsWith("/local/")) {
      const proxy = proxyRequest(
        {
          hostname: upstream.hostname,
          port: upstream.port,
          method: req.method,
          path: req.url,
          headers: req.headers,
          timeout: 15000,
        },
        (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
        },
      );
      // SSE may be idle longer than a normal request; do not impose a short stream timeout.
      if (req.url.includes("/stream")) proxy.setTimeout(0);
      proxy.on("timeout", () => proxy.destroy());
      proxy.on("error", () => {
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Local service unavailable",
              code: "LOCAL_SERVICE_UNAVAILABLE",
            }),
          );
        } else res.destroy();
      });
      res.on("close", () => proxy.destroy());
      req.pipe(proxy);
      return;
    }
    if (!["GET", "HEAD"].includes(req.method ?? "")) {
      res.writeHead(405);
      res.end();
      return;
    }
    try {
      const directory = controller.getActivePublicDir();
      const pathname = decodeURIComponent(
        new URL(req.url ?? "/", "http://localhost").pathname,
      );
      let target = path.resolve(directory, "." + pathname);
      if (target !== directory && !target.startsWith(directory + path.sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (fs.existsSync(target) && fs.statSync(target).isDirectory())
        target = path.join(target, "index.html");
      if (!fs.existsSync(target)) {
        if (path.extname(pathname)) {
          res.writeHead(404);
          res.end();
          return;
        }
        target = path.join(directory, "index.html");
      }
      const actual = fs.realpathSync(target),
        realRoot = fs.realpathSync(directory);
      if (!actual.startsWith(realRoot + path.sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Type":
          mime[path.extname(target)] ?? "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      if (req.method === "HEAD") res.end();
      else fs.createReadStream(target).pipe(res);
    } catch {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end(
        "Selected frontend assets unavailable. Run npm run build:frontend.",
      );
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    server,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
