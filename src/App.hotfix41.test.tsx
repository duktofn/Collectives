import { fireEvent, render } from "@solidjs/testing-library";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import App from "./App";
import {
  clearFolderRefReadinessForTests,
  folderRefReadinessKey,
  setFolderRefReadinessForTests,
  type FolderRefReadinessRecord,
} from "./features/filesystem/folderRefReadiness";
import { uiStore } from "./stores/ui";

vi.mock("./features/collections", () => ({
  getCollections: vi.fn(async () => []),
  initializeIdentityCache: vi.fn(async () => undefined),
}));
vi.mock("./features/settings", () => ({
  loadSettings: vi.fn(async () => ({ theme: "dark", fontScale: 1, customFonts: [] })),
  getFontsDir: vi.fn(async () => "synthetic-fonts"),
}));
vi.mock("./features/archive", () => ({ checkZipConflicts: vi.fn(async () => []) }));
vi.mock("./platform/assets", () => ({ convertFileSrc: vi.fn((path: string) => `asset://${path}`) }));

describe("Hotfix 4.1 FolderRef notice integration", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })),
    });
  });
  afterEach(() => clearFolderRefReadinessForTests());

  it("renders structured stale_read and keeps Retry explicit", async () => {
    const intent = {
      collectionId: "synthetic-collection",
      folderRefEntryId: "synthetic-folder-ref",
      rootPath: "C:/hotfix41/root",
      childPath: "C:/hotfix41/root/new-note.md",
      streamId: "synthetic-stream",
      subscriptionEpoch: "synthetic-epoch",
      generation: 1,
    };
    const record: FolderRefReadinessRecord = {
      key: folderRefReadinessKey(intent.collectionId, intent.folderRefEntryId, intent.childPath),
      intent,
      status: "broken",
      error: { code: "stale_read", message: "FolderRef child is not ready yet", details: { classification: "retryable" } },
      retryable: true,
    };
    setFolderRefReadinessForTests(record);
    uiStore.selectEntry(intent.childPath);
    const view = render(() => <App />);
    expect(view.getByRole("alert").textContent).toContain("stale_read: FolderRef child is not ready yet");
    const retry = view.getByRole("button", { name: "Retry" });
    expect(retry).toBeDefined();
    await fireEvent.click(retry);
  });
});
