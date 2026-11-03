import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "dev-pairing-key",
      configureServer(server) {
        server.middlewares.use("/dev-pairing-key", (_req, res) => {
          try {
            const candidates = [
              process.env.UD_DEVICE_DB ? `${process.env.UD_DEVICE_DB}.session.json` : "",
              path.resolve(__dirname, "../client-local/data/device-b.db.session.json"),
              path.resolve(__dirname, "../client-local/data/device.db.session.json"),
              path.resolve(process.env.LOCALAPPDATA || "", "UpsideDown/computer-2/device.db.session.json"),
              path.resolve(process.env.LOCALAPPDATA || "", "UpsideDown/device.db.session.json"),
            ].filter(Boolean);
            for (const file of candidates) {
              if (fs.existsSync(file)) {
                const data = fs.readFileSync(file, "utf8");
                res.setHeader("Content-Type", "application/json");
                res.end(data);
                return;
              }
            }
          } catch {
            // fallthrough
          }
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "Session key not found" }));
        });
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/local": {
        target: process.env.UD_LOCAL_TARGET ?? "http://127.0.0.1:4100",
        changeOrigin: false,
      },
      "/api": {
        target: process.env.UD_API_TARGET ?? "http://127.0.0.1:4000",
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
