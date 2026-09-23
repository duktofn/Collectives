import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { announcementKey, createAnnouncer } from "./announcer";

describe("a11y announcer", () => {
  let announcer: ReturnType<typeof createAnnouncer>;

  beforeEach(() => {
    announcer = createAnnouncer();
    announcer.mount(document.body);
  });

  afterEach(() => announcer.dispose());

  it("keys transitions by operation, entry and cursor and suppresses duplicates", () => {
    expect(announcementKey("folder", "entry-1", "cursor-2")).toBe("folder|entry-1|cursor-2");
    expect(announcer.polite("Folder is ready", announcementKey("folder", "entry-1", "ready"))).toBe(true);
    expect(announcer.polite("Folder is ready", announcementKey("folder", "entry-1", "ready"))).toBe(false);
    expect(document.querySelector('[data-a11y-announcer="polite"]')?.textContent).toBe("Folder is ready");
  });

  it("suppresses initial render and automatic editor noise", () => {
    expect(announcer.polite("Initial state", "initial", true)).toBe(false);
    expect(announcer.polite("Saving", "save-start")).toBe(false);
    expect(announcer.polite("Keystroke", "key-1")).toBe(false);
  });

  it("keeps urgent errors in the single assertive owner", () => {
    expect(announcer.alert("Navigation failed", "navigation|entry-1")).toBe(true);
    expect(document.querySelector('[data-a11y-announcer="assertive"]')?.textContent).toBe("Navigation failed");
    expect(document.querySelectorAll('[role="alert"]').length).toBe(1);
  });
});
