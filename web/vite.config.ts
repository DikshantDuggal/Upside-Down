import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/local": {
        target: process.env.UD_LOCAL_TARGET ?? "http://127.0.0.1:4100",
        changeOrigin: false,
      },
      "/api": {
        target:
          process.env.UD_API_TARGET ??
          process.env.UD_LOCAL_TARGET ??
          "http://127.0.0.1:4100",
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
