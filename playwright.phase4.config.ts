import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: "phase4.visual.spec.ts",
  webServer: {
    ...base.webServer,
    env: { VITE_PHASE4_VISUAL_FIXTURE: "1" },
  },
});
