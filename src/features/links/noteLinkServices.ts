import type { NoteLinkCandidate, ResolveCandidate, WikilinkFragment } from "../../types";

export type NoteLinkNavigationOutcome = "opened" | "cancelled" | "stale" | "failed" | "unavailable";

export interface NoteLinkNavigationRequest {
  contextId: string;
  requestId: number;
  collectionId: string;
  sourcePath: string | null;
  sourceEntryId: string | null;
  sessionKey: string;
  noteName: string;
  candidates: NoteLinkCandidate[];
  fragment: WikilinkFragment | null;
  isCurrent: () => boolean;
  restoreFocus: () => void;
  claim: () => boolean;
  accept: () => boolean;
  settle: (outcome: NoteLinkNavigationOutcome) => void;
}

export type NoteLinkNavigationRequestInput = Omit<NoteLinkNavigationRequest, "claim" | "accept" | "settle">;

export interface NoteLinkNavigationStarted {
  contextId: string;
  requestId: number;
}

export interface NoteLinkPreviewCacheItem {
  displayName: string;
  path: string;
  preview: string;
  cachedAt: number;
}

export interface NoteLinkCache {
  get: (key: string) => boolean | undefined;
  set: (key: string, valid: boolean) => void;
  getPreview: (key: string) => NoteLinkPreviewCacheItem | undefined;
  setPreview: (key: string, value: NoteLinkPreviewCacheItem) => void;
  epoch: () => number;
  subscribeInvalidation: (listener: () => void) => () => void;
}

export interface NoteLinkContext {
  contextId: string;
  collectionId: () => string | null;
  sourcePath: () => string | null;
  selectedEntryId: () => string | null;
  sessionKey: () => string;
  isDisposed: () => boolean;
  restoreFocus: () => void;
  resolveCandidates: (collectionId: string, noteName: string, sourcePath?: string) => Promise<NoteLinkCandidate[]>;
  searchIndex: (collectionId: string, query: string, limit?: number) => Promise<ResolveCandidate[]>;
  readCandidateContent: (candidate: NoteLinkCandidate) => Promise<string>;
  cache: NoteLinkCache;
  navigationStarted: (requestId: number) => void;
  requestNavigation: (request: NoteLinkNavigationRequestInput) => Promise<NoteLinkNavigationOutcome>;
}

export const NOTE_LINK_NAVIGATION_REQUEST_EVENT = "collectives:note-link-navigation-request";
export const NOTE_LINK_NAVIGATION_STARTED_EVENT = "collectives:note-link-navigation-started";
export const NOTE_LINK_CONTEXT_DISPOSED_EVENT = "collectives:note-link-context-disposed";

const MAX_CACHED_LINK_STATUSES = 1000;
const MAX_CACHED_PREVIEWS = 100;
const PREVIEW_CACHE_TTL_MS = 30_000;
const cachedLinkStatuses = new Map<string, boolean>();
const cachedPreviews = new Map<string, NoteLinkPreviewCacheItem>();
const invalidationListeners = new Set<() => void>();
let invalidationEpoch = 0;
const pendingNavigations = new Map<string, Map<number, { accepted: boolean; settle: (outcome: NoteLinkNavigationOutcome) => void }>>();

export function settleNoteLinkNavigation(
  contextId: string,
  requestId: number,
  outcome: NoteLinkNavigationOutcome,
): void {
  const contextNavigations = pendingNavigations.get(contextId);
  const pending = contextNavigations?.get(requestId);
  if (!pending) return;
  contextNavigations?.delete(requestId);
  if (contextNavigations?.size === 0) pendingNavigations.delete(contextId);
  pending.settle(outcome);
}

export function cancelNoteLinkNavigations(
  outcome: NoteLinkNavigationOutcome = "stale",
  includeAccepted = true,
): void {
  for (const [contextId, navigations] of [...pendingNavigations]) {
    for (const [requestId, pending] of [...navigations]) {
      if (includeAccepted || !pending.accepted) settleNoteLinkNavigation(contextId, requestId, outcome);
    }
  }
}

export function cancelNoteLinkContext(contextId: string, outcome: NoteLinkNavigationOutcome = "stale"): void {
  const navigations = pendingNavigations.get(contextId);
  if (!navigations) return;
  for (const requestId of [...navigations.keys()]) settleNoteLinkNavigation(contextId, requestId, outcome);
}

export function requestNoteLinkNavigation(
  request: NoteLinkNavigationRequestInput,
): Promise<NoteLinkNavigationOutcome> {
  if (typeof window === "undefined") return Promise.resolve("unavailable");
  return new Promise((resolve) => {
    let settled = false;
    let claimed = false;
    const contextNavigations = pendingNavigations.get(request.contextId) ?? new Map();
    const settle = (outcome: NoteLinkNavigationOutcome) => {
      if (settled) return;
      settled = true;
      contextNavigations.delete(request.requestId);
      if (contextNavigations.size === 0) pendingNavigations.delete(request.contextId);
      resolve(outcome);
    };
    const pending = { accepted: false, settle };
    contextNavigations.set(request.requestId, pending);
    pendingNavigations.set(request.contextId, contextNavigations);
    const detail: NoteLinkNavigationRequest = {
      ...request,
      claim: () => {
        if (settled || claimed) return false;
        claimed = true;
        return true;
      },
      accept: () => {
        if (settled || !claimed || !request.isCurrent()) return false;
        pending.accepted = true;
        return true;
      },
      settle,
    };
    window.dispatchEvent(new CustomEvent(NOTE_LINK_NAVIGATION_REQUEST_EVENT, { detail }));
    if (!settled && !claimed) settle("unavailable");
  });
}

export function getCachedLinkStatus(key: string): boolean | undefined {
  return cachedLinkStatuses.get(key);
}

export function setCachedLinkStatus(key: string, valid: boolean): void {
  if (cachedLinkStatuses.size >= MAX_CACHED_LINK_STATUSES && !cachedLinkStatuses.has(key)) {
    const oldest = cachedLinkStatuses.keys().next().value;
    if (oldest !== undefined) cachedLinkStatuses.delete(oldest);
  }
  cachedLinkStatuses.set(key, valid);
}

export function noteLinkStatusCacheKey(collectionId: string, noteName: string): string {
  return JSON.stringify([collectionId, noteName]);
}

export function getCachedNoteLinkPreview(key: string): NoteLinkPreviewCacheItem | undefined {
  const cached = cachedPreviews.get(key);
  if (!cached) return undefined;
  if (Date.now() - cached.cachedAt >= PREVIEW_CACHE_TTL_MS) {
    cachedPreviews.delete(key);
    return undefined;
  }
  cachedPreviews.delete(key);
  cachedPreviews.set(key, cached);
  return cached;
}

export function setCachedNoteLinkPreview(key: string, value: NoteLinkPreviewCacheItem): void {
  cachedPreviews.delete(key);
  cachedPreviews.set(key, value);
  while (cachedPreviews.size > MAX_CACHED_PREVIEWS) {
    const oldest = cachedPreviews.keys().next().value;
    if (oldest === undefined) break;
    cachedPreviews.delete(oldest);
  }
}

export function getNoteLinkCacheEpoch(): number {
  return invalidationEpoch;
}

export function subscribeNoteLinkCacheInvalidation(listener: () => void): () => void {
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}

export function invalidateNoteLinkCache(): void {
  cachedLinkStatuses.clear();
  cachedPreviews.clear();
  invalidationEpoch += 1;
  for (const listener of [...invalidationListeners]) listener();
}

export function clearNoteLinkCacheForTests(): void {
  invalidateNoteLinkCache();
  cancelNoteLinkNavigations("stale", true);
}

export const noteLinkCache: NoteLinkCache = {
  get: getCachedLinkStatus,
  set: setCachedLinkStatus,
  getPreview: getCachedNoteLinkPreview,
  setPreview: setCachedNoteLinkPreview,
  epoch: getNoteLinkCacheEpoch,
  subscribeInvalidation: subscribeNoteLinkCacheInvalidation,
};
