import base from './playwright.ux.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://127.0.0.1:4181' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4181',
    url: 'http://127.0.0.1:4181',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  testMatch: 'code-click-drift.spec.ts',
  timeout: 60_000,
  projects: [
    { name: 'scale-1', use: { deviceScaleFactor: 1 } },
    { name: 'scale-1.5', use: { deviceScaleFactor: 1.5 } },
  ],
});
