export interface RecoveryDraft {
  id: string;
  collectionId: string;
  entryId: string;
  path: string;
  baseVersionToken: string;
  content: string;
  revision: number;
  sessionId: string;
  updatedAt: number;
}

const STORAGE_KEY = "collectives.recoveryDrafts.v1";
const MAX_DRAFTS = 8;
const MAX_TOTAL_BYTES = 6 * 1024 * 1024;
const MAX_SINGLE_BYTES = 2 * 1024 * 1024;

let pendingDraft: RecoveryDraft | null = null;
let pendingCapture: { metadata: Omit<RecoveryDraft, "content">; readContent: () => string | null } | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | undefined;

function readStoredDrafts(): RecoveryDraft[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((draft): draft is RecoveryDraft => Boolean(
      draft && typeof draft === "object"
      && typeof draft.id === "string" && typeof draft.collectionId === "string"
      && typeof draft.entryId === "string" && typeof draft.path === "string"
      && typeof draft.baseVersionToken === "string" && typeof draft.content === "string"
      && typeof draft.revision === "number" && typeof draft.sessionId === "string"
      && typeof draft.updatedAt === "number"
      && new TextEncoder().encode(draft.content).length <= MAX_SINGLE_BYTES,
    ));
  } catch {
    return [];
  }
}

function writeStoredDrafts(drafts: RecoveryDraft[]): void {
  try {
    let totalBytes = 0;
    const bounded = drafts
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .filter((draft) => {
        const bytes = new TextEncoder().encode(draft.content).length;
        if (bytes > MAX_SINGLE_BYTES || totalBytes + bytes > MAX_TOTAL_BYTES) return false;
        totalBytes += bytes;
        return true;
      })
      .slice(0, MAX_DRAFTS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    // Storage may be disabled or full. The editor's normal autosave remains active.
  }
}

function persistDraft(draft: RecoveryDraft): void {
  const existing = readStoredDrafts().filter((item) => item.id !== draft.id);
  writeStoredDrafts([draft, ...existing]);
}

export function makeRecoveryDraftId(collectionId: string, entryId: string, path: string): string {
  return `${collectionId}\u0000${entryId}\u0000${path.toLowerCase()}`;
}

export function scheduleRecoveryDraft(draft: RecoveryDraft, delayMs = 450): void {
  if (new TextEncoder().encode(draft.content).length > MAX_SINGLE_BYTES) return;
  pendingCapture = null;
  pendingDraft = draft;
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    if (pendingDraft?.id === draft.id && pendingDraft.sessionId === draft.sessionId) persistDraft(draft);
    pendingDraft = null;
    pendingTimer = undefined;
  }, delayMs);
}

export function scheduleRecoveryDraftCapture(
  metadata: Omit<RecoveryDraft, "content">,
  readContent: () => string | null,
  delayMs = 900,
): void {
  pendingDraft = null;
  pendingCapture = { metadata, readContent };
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    const capture = pendingCapture;
    pendingCapture = null;
    pendingTimer = undefined;
    if (!capture || capture.metadata.id !== metadata.id || capture.metadata.sessionId !== metadata.sessionId) return;
    const content = capture.readContent();
    if (content !== null && new TextEncoder().encode(content).length <= MAX_SINGLE_BYTES) {
      persistDraft({ ...capture.metadata, content });
    }
  }, delayMs);
}

export function listRecoveryDrafts(): RecoveryDraft[] {
  return readStoredDrafts().sort((left, right) => right.updatedAt - left.updatedAt);
}

export function removeRecoveryDraft(id: string): void {
  if (pendingDraft?.id === id) {
    pendingDraft = null;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = undefined;
  }
  if (pendingCapture?.metadata.id === id) {
    pendingCapture = null;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = undefined;
  }
  writeStoredDrafts(readStoredDrafts().filter((draft) => draft.id !== id));
}

export function clearPersistedRecoveryDraft(path: string, sessionId: string, revision: number): void {
  const normalized = path.toLowerCase();
  if (pendingDraft?.path.toLowerCase() === normalized && pendingDraft.sessionId === sessionId && pendingDraft.revision <= revision) {
    pendingDraft = null;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = undefined;
  }
  if (pendingCapture?.metadata.path.toLowerCase() === normalized && pendingCapture.metadata.sessionId === sessionId && pendingCapture.metadata.revision <= revision) {
    pendingCapture = null;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = undefined;
  }
  writeStoredDrafts(readStoredDrafts().filter((draft) =>
    !(draft.path.toLowerCase() === normalized && draft.sessionId === sessionId && draft.revision <= revision),
  ));
}

export function flushPendingRecoveryDraft(): void {
  if (pendingCapture) {
    const capture = pendingCapture;
    pendingCapture = null;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = undefined;
    const content = capture.readContent();
    if (content !== null && new TextEncoder().encode(content).length <= MAX_SINGLE_BYTES) persistDraft({ ...capture.metadata, content });
    return;
  }
  if (!pendingDraft) return;
  const draft = pendingDraft;
  pendingDraft = null;
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = undefined;
  persistDraft(draft);
}

