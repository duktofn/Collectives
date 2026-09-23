import { expect, test } from "@playwright/test";

test.describe("Phase 6 accessibility emulation", () => {
  test("keeps the production shell within the single-tree/live-region contract", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto("/");
    await page.waitForLoadState("load");
    expect(await page.locator('[role="tree"]').count()).toBeLessThanOrEqual(1);
    expect(await page.locator('[data-a11y-announcer]').count()).toBeLessThanOrEqual(2);
    expect(await page.locator('.activity-status[role="status"]').getAttribute("aria-live")).toBe("off");
  });

  test("emulates forced colors and reduced motion without changing OS settings", async ({ browser }) => {
    const context = await browser.newContext({ forcedColors: "active", reducedMotion: "reduce", viewport: { width: 1024, height: 768 } });
    const page = await context.newPage();
    await page.goto("/");
    expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    await context.close();
  });
});
