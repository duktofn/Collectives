import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4176",
    colorScheme: "dark",
    reducedMotion: "reduce",
    forcedColors: "none",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4176",
    url: "http://127.0.0.1:4176",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
