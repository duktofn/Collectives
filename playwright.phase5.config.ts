import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4175", colorScheme: "dark", reducedMotion: "reduce" },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4175",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_PHASE5_WORKFLOW_FIXTURE: "1" },
  },
});
