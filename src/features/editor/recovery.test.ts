import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPersistedRecoveryDraft,
  flushPendingRecoveryDraft,
  listRecoveryDrafts,
  makeRecoveryDraftId,
  removeRecoveryDraft,
  scheduleRecoveryDraft,
  scheduleRecoveryDraftCapture,
} from "./recovery";

const draft = (revision: number, content: string) => ({
  id: makeRecoveryDraftId("collection", "entry", "C:/notes/a.md"),
  collectionId: "collection",
  entryId: "entry",
  path: "C:/notes/a.md",
  baseVersionToken: "disk-token",
  content,
  revision,
  sessionId: "session-a",
  updatedAt: revision,
});

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => vi.useRealTimers());

describe("local recovery drafts", () => {
  it("coalesces drafts for one note and keeps the latest content", () => {
    scheduleRecoveryDraft(draft(1, "older"), 450);
    scheduleRecoveryDraft(draft(2, "latest"), 450);
    vi.advanceTimersByTime(450);
    expect(listRecoveryDrafts()).toMatchObject([{ content: "latest", revision: 2 }]);
  });

  it("captures the live document only after the debounce interval", () => {
    let content = "first";
    const metadata = draft(3, "");
    scheduleRecoveryDraftCapture(metadata, () => content, 900);
    content = "latest live text";
    vi.advanceTimersByTime(900);
    expect(listRecoveryDrafts()[0]?.content).toBe("latest live text");
  });

  it("clears only the matching persisted session through the saved revision", () => {
    scheduleRecoveryDraft(draft(2, "saved"), 0);
    flushPendingRecoveryDraft();
    scheduleRecoveryDraft({ ...draft(3, "newer"), sessionId: "session-b" }, 0);
    flushPendingRecoveryDraft();
    clearPersistedRecoveryDraft("C:/notes/a.md", "session-a", 2);
    expect(listRecoveryDrafts()).toMatchObject([{ content: "newer", sessionId: "session-b" }]);
  });

  it("removes a draft only when it is explicitly dismissed", () => {
    const saved = draft(4, "keep until dismissed");
    scheduleRecoveryDraft(saved, 0);
    flushPendingRecoveryDraft();
    removeRecoveryDraft(saved.id);
    expect(listRecoveryDrafts()).toEqual([]);
  });
});

