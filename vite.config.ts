import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  build: { target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13" },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    exclude: ["tests/*.test.mjs", "node_modules/**", "dist/**"],
    // Radix portals can keep jsdom's event loop busy for tens of seconds on
    // Docker Desktop even though the interaction completes. A short timeout
    // reports false negatives and does not interrupt that synchronous work.
    testTimeout: 60_000,
  },
});
