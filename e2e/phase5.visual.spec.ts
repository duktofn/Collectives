import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const runId = process.env.PHASE5_RUN_ID ?? "phase5-local";
const phase = process.env.PHASE5_CAPTURE_PHASE ?? "before";
const root = resolve("artifacts/phase5", runId, "visual", phase);
const viewports = [{ name: "800x600", width: 800, height: 600 }, { name: "1024x768", width: 1024, height: 768 }, { name: "1280x800", width: 1280, height: 800 }];
const themes = ["dark", "light", "system"];
const states = ["empty", "active", "folderref-checking", "folderref-broken", "archive-pending", "settings-pending", "error"];

for (const viewport of viewports) for (const theme of themes) for (const state of states) {
  test(`${phase}/${viewport.name}/${theme}/${state}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ colorScheme: theme === "system" ? "light" : theme as "dark" | "light" });
    await page.goto(`/?state=${state}&theme=${theme}`);
    const fixture = page.locator('[data-phase5-fixture="workflow-v1"]');
    await expect(fixture).toHaveCount(1);
    await expect(fixture).toHaveAttribute("data-state", state);
    if (theme === "system") {
      await expect(fixture).toHaveAttribute("data-system-match-media", "light");
      await expect(fixture).toHaveAttribute("data-resolved-theme", "light");
    }
    const contrast = await fixture.evaluate((element) => {
      const parse = (value: string) => value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)?.slice(1).map(Number) ?? [0, 0, 0];
      const luminance = (value: string) => parse(value).map((channel) => { const n = channel / 255; return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
      const style = getComputedStyle(element); const foreground = luminance(style.color); const background = luminance(style.backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, viewportWidth: innerWidth, viewportHeight: innerHeight }));
    expect(overflow.width).toBeLessThanOrEqual(overflow.viewportWidth);
    expect(overflow.height).toBeLessThanOrEqual(overflow.viewportHeight);
    const output = join(root, theme, state, `${viewport.name}.png`);
    mkdirSync(resolve(output, ".."), { recursive: true });
    await page.screenshot({ path: output, fullPage: false });
  });
}
