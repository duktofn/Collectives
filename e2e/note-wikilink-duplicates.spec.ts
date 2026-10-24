import { expect, test, type Page } from "@playwright/test";
import { installWorkspaceMock } from "./helpers/workspaceMock";

const root = "D:/Sample/Knowledge";
const archivedReviewPath = `${root}/Archive/Research and references.md`;

async function mountWikiLinkWorkspace(page: Page, source: string): Promise<void> {
  await installWorkspaceMock(page, "dark", false, false, source);
  await page.addInitScript(() => {
    type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: Invoke } }).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    const sourceRoot = "D:/Sample/Knowledge";
    const weeklyReview = {
      displayName: "Weekly review",
      entryId: "note-2",
      path: `${sourceRoot}/Weekly review.md`,
      entryType: "file",
    };
    const existingResearch = {
      displayName: "Research and references",
      entryId: "note-1",
      path: `${sourceRoot}/Research and references.md`,
      entryType: "file",
    };
    const archivedResearch = {
      displayName: "Research and references",
      entryId: "archived-research",
      path: `${sourceRoot}/Archive/Research and references.md`,
      entryType: "file",
    };
    const fixtureWindow = window as unknown as {
      __noteLinkCandidates?: typeof existingResearch[];
      __noteLinkResolveCount?: number;
    };
    fixtureWindow.__noteLinkCandidates = [existingResearch, archivedResearch];
    fixtureWindow.__noteLinkResolveCount = 0;

    internals.invoke = async (command, args = {}) => {
      if (command === "get_collections") {
        const result = await invoke(command, args) as Array<{ entries: Array<Record<string, unknown>> }>;
        if (result[0]) {
          result[0].entries.push({
            id: "archive-group",
            type: "group",
            name: "Archive",
            children: [{ id: archivedResearch.entryId, type: "file", path: archivedResearch.path }],
          });
        }
        return result;
      }
      if (command === "resolve_wikilink") {
        fixtureWindow.__noteLinkResolveCount = (fixtureWindow.__noteLinkResolveCount ?? 0) + 1;
        const noteName = String(args.noteName ?? "");
        if (noteName === "Incomplete scan") return Promise.reject(new Error("note_link_scan_incomplete: test traversal cap reached"));
        if (noteName === "Weekly review") return [weeklyReview];
        if (noteName === "Research and references") return fixtureWindow.__noteLinkCandidates ?? [];
        return [];
      }
      if (command === "read_file") {
        const path = String(args.path ?? "").replace(/\\/g, "/");
        if (path === weeklyReview.path) {
          return { content: "# Weekly review target\n\nOpened the sole match.", versionToken: "weekly-review-v1", fileKind: "markdown" };
        }
        if (path === existingResearch.path) {
          return { content: "# Remaining target\n\nOpened the remaining match.", versionToken: "existing-v1", fileKind: "markdown" };
        }
        if (path === archivedResearch.path) {
          return { content: "# Archived target\n\nOpened the archived duplicate.", versionToken: "archived-v1", fileKind: "markdown" };
        }
      }
      return invoke(command, args);
    };
    window.addEventListener("collectives:note-link-navigation-request", (event) => {
      const detail = (event as CustomEvent<{ fragment: unknown }>).detail;
      (window as unknown as { __lastNoteLinkFragment?: unknown }).__lastNoteLinkFragment = detail?.fragment;
    });
  });
  await page.goto("/e2e/workspace.html");
  await expect(page.locator(".cm-content")).toBeVisible();
}

async function activateWikiLink(page: Page, name: string): Promise<void> {
  await page.locator(".cm-wikilink").filter({ hasText: name }).first().click({ modifiers: ["Control"] });
}

test("a missing WikiLink keeps the existing create-target flow", async ({ page }) => {
  await mountWikiLinkWorkspace(page, "See [[Missing note]] for details.");
  await activateWikiLink(page, "Missing note");

  await expect(page.getByRole("dialog", { name: "WikiLink target not found" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Choose a note for Missing note" })).toHaveCount(0);
});

test("a sole candidate opens directly and carries its heading fragment", async ({ page }) => {
  await mountWikiLinkWorkspace(page, "See [[Weekly review#Target heading]] for details.");
  await activateWikiLink(page, "Weekly review");

  await expect(page.locator(".cm-content")).toContainText("Opened the sole match.");
  await expect(page.getByRole("dialog", { name: /Choose a note for/ })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __lastNoteLinkFragment?: unknown }).__lastNoteLinkFragment))
    .toEqual({ type: "heading", value: "Target heading" });
});

test("an incomplete candidate scan shows an error without presenting partial choices", async ({ page }) => {
  await mountWikiLinkWorkspace(page, "See [[Incomplete scan]] for details.");
  await activateWikiLink(page, "Incomplete scan");

  await expect(page.locator(".app-notice")).toContainText("WikiLink lookup failed");
  await expect(page.getByRole("dialog", { name: /Choose a note for/ })).toHaveCount(0);
});

test("duplicate candidates show both paths, can be cancelled, and open the chosen note", async ({ page }) => {
  await mountWikiLinkWorkspace(page, "See [[Research and references]] for details.");

  await activateWikiLink(page, "Research and references");
  const dialog = page.getByRole("dialog", { name: "Choose a note for [[Research and references]]" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("option")).toHaveCount(2);
  await expect(dialog).toContainText(`${root}/Research and references.md`);
  await expect(dialog).toContainText(archivedReviewPath);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "WikiLink target not found" })).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("See");
  const commandsAfterCancel = await page.evaluate(() => (window as unknown as { __workspaceCommands?: string[] }).__workspaceCommands ?? []);
  expect(commandsAfterCancel).not.toContain("write_file");

  const resolveCountAfterCancel = await page.evaluate(() => (window as unknown as { __noteLinkResolveCount?: number }).__noteLinkResolveCount ?? 0);
  await page.evaluate(() => {
    const state = window as unknown as { __noteLinkCandidates?: Array<{ displayName: string; entryId: string; path: string; entryType: string }> };
    state.__noteLinkCandidates = [{ displayName: "Research and references", entryId: "note-1", path: "D:/Sample/Knowledge/Research and references.md", entryType: "file" }];
  });
  await activateWikiLink(page, "Research and references");
  await expect(page.locator(".cm-content")).toContainText("Opened the remaining match.");
  const resolveCountAfterSecondClick = await page.evaluate(() => (window as unknown as { __noteLinkResolveCount?: number }).__noteLinkResolveCount ?? 0);
  expect(resolveCountAfterSecondClick).toBeGreaterThan(resolveCountAfterCancel);
});

test("choosing one of two duplicate paths opens that exact note", async ({ page }) => {
  await mountWikiLinkWorkspace(page, "See [[Research and references]] for details.");
  await activateWikiLink(page, "Research and references");
  const dialog = page.getByRole("dialog", { name: "Choose a note for [[Research and references]]" });
  await expect(dialog.getByRole("option")).toHaveCount(2);
  await dialog.getByRole("option").filter({ hasText: archivedReviewPath }).click();
  await expect(page.locator(".cm-content")).toContainText("Opened the archived duplicate.");
});
