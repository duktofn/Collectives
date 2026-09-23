import { batch } from "solid-js";
import { createStore } from "solid-js/store";
import * as editorApi from "../editor";
import { asSafetyError, formatIpcError, type SafetyError } from "../../shared/ipc/errors";
import { editorStore } from "../../stores/editor";
import { uiStore } from "../../stores/ui";

export type FolderRefReadinessStatus = "checking" | "ready" | "broken";

export interface FolderRefIntent {
  collectionId: string;
  folderRefEntryId: string;
  rootPath: string;
  childPath: string;
  streamId: string;
  subscriptionEpoch: string;
  generation: number;
}
export type FolderRefIntentInput = Omit<FolderRefIntent, "generation">;

export interface FolderRefReadinessRecord {
  key: string;
  intent: FolderRefIntent;
  status: FolderRefReadinessStatus;
  error: SafetyError | null;
  retryable: boolean;
}

interface FolderRefReadinessState {
  activeIntent: FolderRefIntent | null;
  records: Record<string, FolderRefReadinessRecord>;
}

const [state, setState] = createStore<FolderRefReadinessState>({ activeIntent: null, records: {} });
const inFlight = new Map<string, Promise<void>>();
type PendingTimer = { timer: ReturnType<typeof setTimeout>; resolve: () => void };
const pendingTimers = new Map<string, Set<PendingTimer>>();
let invalidation = 0;

export const folderRefReadiness = { state };

export function normalizeFolderRefPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function folderRefReadinessKey(collectionId: string, folderRefEntryId: string, childPath: string): string {
  return `${collectionId}:${folderRefEntryId}:${normalizeFolderRefPath(childPath)}`;
}

export function getFolderRefReadiness(
  collectionId: string,
  folderRefEntryId: string,
  childPath: string,
): FolderRefReadinessRecord | null {
  return state.records[folderRefReadinessKey(collectionId, folderRefEntryId, childPath)] ?? null;
}

function setRecord(intent: FolderRefIntent, status: FolderRefReadinessStatus, error: SafetyError | null = null): void {
  const key = folderRefReadinessKey(intent.collectionId, intent.folderRefEntryId, intent.childPath);
  setState("records", key, { key, intent, status, error, retryable: Boolean(error?.details && typeof error.details === "object" && (error.details as Record<string, unknown>).classification === "retryable") });
}

function isCurrent(intent: FolderRefIntent, token: number): boolean {
  return token === invalidation
    && state.activeIntent?.generation === intent.generation
    && state.activeIntent?.collectionId === intent.collectionId
    && state.activeIntent?.folderRefEntryId === intent.folderRefEntryId
    && normalizeFolderRefPath(state.activeIntent.childPath) === normalizeFolderRefPath(intent.childPath)
    && uiStore.state.selectedEntryId === intent.childPath;
}

function wait(key: string, milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timers = pendingTimers.get(key) ?? new Set<PendingTimer>();
    const pending: PendingTimer = { timer: setTimeout(() => {
      timers.delete(pending);
      resolve();
    }, milliseconds), resolve };
    timers.add(pending);
    pendingTimers.set(key, timers);
  });
}

function cancelTimers(): void {
  for (const timers of pendingTimers.values()) {
    for (const pending of timers) {
      clearTimeout(pending.timer);
      pending.resolve();
    }
  }
  pendingTimers.clear();
}

function isRetryableStaleRead(error: unknown): boolean {
  const safety = asSafetyError(error);
  if (!safety || safety.code !== "stale_read" || !safety.details || typeof safety.details !== "object") return false;
  return (safety.details as Record<string, unknown>).classification === "retryable";
}

export async function requestFolderRefChild(intentInput: Omit<FolderRefIntent, "generation">): Promise<boolean> {
  const flushed = await editorStore.flushPendingSave();
  if (!flushed) return false;
  const generation = editorStore.beginFolderRefSnapshot();
  const intent: FolderRefIntent = { ...intentInput, generation };
  invalidation += 1;
  batch(() => {
    setState("activeIntent", intent);
    setRecord(intent, "checking");
    uiStore.selectEntry(intent.childPath);
  });
  return true;
}

export function cancelFolderRefReadiness(folderRefEntryId?: string): void {
  invalidation += 1;
  cancelTimers();
  const records = { ...state.records };
  for (const [key, record] of Object.entries(state.records)) {
    if (!folderRefEntryId || record.intent.folderRefEntryId === folderRefEntryId) {
      delete records[key];
    }
  }
  setState("records", records);
  if (!folderRefEntryId || state.activeIntent?.folderRefEntryId === folderRefEntryId) setState("activeIntent", null);
}

export function retryFolderRefChild(record: FolderRefReadinessRecord): void {
  if (!record.retryable || state.activeIntent?.generation !== record.intent.generation) return;
  setRecord(record.intent, "checking");
  void resolveFolderRefIntent(record.intent);
}

export function retryFolderRefChildFromEvent(
  payload: { collectionId: string; streamId: string; subscriptionEpoch: string; changes: Array<{ path?: string; changedFilePath?: string; entryId?: string }> },
  rootPath: string,
  folderRefEntryId: string,
): void {
  const intent = state.activeIntent;
  if (!intent || intent.collectionId !== payload.collectionId || intent.folderRefEntryId !== folderRefEntryId) return;
  if (intent.streamId !== payload.streamId || intent.subscriptionEpoch !== payload.subscriptionEpoch) return;
  if (uiStore.state.selectedEntryId !== intent.childPath) return;
  const root = normalizeFolderRefPath(rootPath);
  const matched = payload.changes.some((change) => {
    const path = normalizeFolderRefPath(change.changedFilePath ?? change.path ?? "");
    return path === normalizeFolderRefPath(intent.childPath) && path.startsWith(`${root}/`);
  });
  const record = getFolderRefReadiness(intent.collectionId, intent.folderRefEntryId, intent.childPath);
  if (matched && record?.status === "broken" && record.retryable) retryFolderRefChild(record);
}

export async function resolveFolderRefIntent(intent: FolderRefIntent): Promise<void> {
  const key = folderRefReadinessKey(intent.collectionId, intent.folderRefEntryId, intent.childPath);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const token = invalidation;
  const operation = (async () => {
    const delays = [0, 25, 75, 175];
    let lastError: unknown = null;
    for (const delay of delays) {
      if (delay > 0) await wait(key, delay);
      if (!isCurrent(intent, token)) return;
      try {
        const snapshot = await editorApi.readFolderRefSnapshot(intent.rootPath, intent.childPath);
        if (!isCurrent(intent, token)) return;
        if (!editorStore.commitFolderRefSnapshot(intent.childPath, snapshot, intent.generation)) return;
        setRecord(intent, "ready");
        return;
      } catch (error) {
        lastError = error;
        if (!isRetryableStaleRead(error)) break;
      }
    }
    if (!isCurrent(intent, token)) return;
    const safety = asSafetyError(lastError) ?? {
      code: "stale_read",
      message: formatIpcError(lastError),
      details: { classification: "terminal" },
    };
    setRecord(intent, "broken", safety);
  })().finally(() => { inFlight.delete(key); pendingTimers.delete(key); });
  inFlight.set(key, operation);
  return operation;
}

export function clearFolderRefReadinessForTests(): void {
  invalidation += 1;
  cancelTimers();
  inFlight.clear();
  setState({ activeIntent: null, records: {} });
}

export function setFolderRefReadinessForTests(record: FolderRefReadinessRecord | null): void {
  clearFolderRefReadinessForTests();
  if (!record) return;
  setState("activeIntent", record.intent);
  setState("records", record.key, record);
}
