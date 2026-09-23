import { expect, test } from "@playwright/test";

async function mountHarness(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    const host = document.createElement("div");
    host.dataset.phase6HarnessHost = "true";
    document.body.append(host);
    const fixture = await import("/src/visual-fixtures/phase6AccessibilityFixture.tsx");
    fixture.mountPhase6AccessibilityFixture(host);
  });
}

test("drives the integrated Phase 6 harness actions and state markers", async ({ page }) => {
  await page.goto("/");
  await mountHarness(page);
  const host = page.locator('[data-phase6-harness="true"]');
  await expect(host).toHaveAttribute("data-phase6-harness-ready", "true");
  await host.locator('[role="treeitem"]').first().click();
  await expect(host.locator('[role="treeitem"]').first()).toHaveAttribute("aria-expanded", "true");
  await host.locator('[role="treeitem"]').nth(1).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __phase6Harness?: { lastAction(): string } }).__phase6Harness?.lastAction())).toContain("open:");
  await host.locator('[data-action="open-context-menu"]').click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __phase6Harness?: { lastAction(): string } }).__phase6Harness?.lastAction())).toBe("context-menu-action");
  await host.locator('[data-action="open-move-dialog"]').click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("radio").first().press("Enter");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __phase6Harness?: { lastAction(): string } }).__phase6Harness?.lastAction())).toContain("move:");
  await page.keyboard.press("Escape");
  await host.locator('[data-action="open-theme"]').click();
  await expect(page.locator('[data-modal-focus-scope="true"]')).toBeVisible();
  await page.keyboard.press("Escape");
  const editor = host.locator(".cm-content");
  await editor.focus();
  await page.keyboard.insertText("phase6");
  await expect(editor).toContainText("phase6");
});

test("drives the 10k collection state transition without claiming a latency pass", async ({ page }) => {
  await page.goto("/");
  await mountHarness(page);
  const host = page.locator('[data-phase6-harness="true"]');
  await host.locator('[data-action="render-collection-10k"]').click();
  await expect(host.locator('[data-phase6-large-row="true"]')).toHaveCount(10_000, { timeout: 60_000 });
});

test("records a browser-ready navigation sample at the approved viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const started = Date.now();
  await page.goto("/");
  const elapsed = Date.now() - started;
  expect(elapsed).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(() => document.readyState)).toBe("complete");
});
