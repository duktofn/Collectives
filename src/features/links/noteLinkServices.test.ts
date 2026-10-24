import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NOTE_LINK_NAVIGATION_REQUEST_EVENT,
  cancelNoteLinkNavigations,
  clearNoteLinkCacheForTests,
  noteLinkCache,
  noteLinkStatusCacheKey,
  requestNoteLinkNavigation,
} from "./noteLinkServices";
import type { NoteLinkNavigationRequest } from "./noteLinkServices";

const requestInput = (isCurrent: () => boolean = () => true) => ({
  contextId: "context-one",
  requestId: 1,
  collectionId: "collection-one",
  sourcePath: "C:/notes/source.md",
  sourceEntryId: "source-entry",
  sessionKey: "session-one",
  noteName: "Target",
  candidates: [],
  fragment: null,
  isCurrent,
  restoreFocus: vi.fn(),
});

describe("note-link navigation services", () => {
  afterEach(() => {
    clearNoteLinkCacheForTests();
  });

  it("settles unavailable when no App navigation provider claims the request", async () => {
    await expect(requestNoteLinkNavigation(requestInput())).resolves.toBe("unavailable");
  });

  it("requires a claim and a current source context before accepting navigation", async () => {
    let current = true;
    const handler = (event: Event) => {
      const request = (event as CustomEvent<NoteLinkNavigationRequest>).detail;
      expect(request.claim()).toBe(true);
      expect(request.claim()).toBe(false);
      current = false;
      expect(request.accept()).toBe(false);
      request.settle("stale");
    };
    window.addEventListener(NOTE_LINK_NAVIGATION_REQUEST_EVENT, handler, { once: true });

    await expect(requestNoteLinkNavigation(requestInput(() => current))).resolves.toBe("stale");
    window.removeEventListener(NOTE_LINK_NAVIGATION_REQUEST_EVENT, handler);
  });

  it("settles accepted navigation when its context is cancelled", async () => {
    const handler = (event: Event) => {
      const request = (event as CustomEvent<NoteLinkNavigationRequest>).detail;
      expect(request.claim()).toBe(true);
      expect(request.accept()).toBe(true);
    };
    window.addEventListener(NOTE_LINK_NAVIGATION_REQUEST_EVENT, handler, { once: true });

    const pending = requestNoteLinkNavigation(requestInput());
    cancelNoteLinkNavigations("cancelled", true);
    await expect(pending).resolves.toBe("cancelled");
    window.removeEventListener(NOTE_LINK_NAVIGATION_REQUEST_EVENT, handler);
  });

  it("keeps collection and note-name cache keys unambiguous across delimiter collisions", () => {
    expect(noteLinkStatusCacheKey("a:b", "c")).not.toBe(noteLinkStatusCacheKey("a", "b:c"));
    noteLinkCache.set(noteLinkStatusCacheKey("a:b", "c"), true);
    expect(noteLinkCache.get(noteLinkStatusCacheKey("a", "b:c"))).toBeUndefined();
  });

  it("preserves the bounded FIFO status cache", () => {
    for (let index = 0; index < 1000; index += 1) noteLinkCache.set(`status-${index}`, true);
    expect(noteLinkCache.get("status-0")).toBe(true);
    noteLinkCache.set("status-1000", true);
    expect(noteLinkCache.get("status-0")).toBeUndefined();
    expect(noteLinkCache.get("status-1")).toBe(true);
  });
});
