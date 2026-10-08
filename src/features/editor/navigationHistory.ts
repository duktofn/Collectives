import { createSignal } from "solid-js";
import type { ResolveCandidate } from "../../types";

export interface NavigationItem extends ResolveCandidate {
  collectionId: string;
}

interface HistoryState {
  items: NavigationItem[];
  cursor: number;
  pendingCursor: number | null;
}

const MAX_HISTORY = 50;
const histories = new Map<string, HistoryState>();
const [revision, setRevision] = createSignal(0);

function stateFor(collectionId: string): HistoryState {
  let state = histories.get(collectionId);
  if (!state) {
    state = { items: [], cursor: -1, pendingCursor: null };
    histories.set(collectionId, state);
  }
  return state;
}

function sameLocation(left: NavigationItem | undefined, right: NavigationItem): boolean {
  return Boolean(left && left.collectionId === right.collectionId && left.entryId === right.entryId);
}

export function recordNavigation(item: NavigationItem): void {
  const state = stateFor(item.collectionId);
  if (state.pendingCursor !== null && sameLocation(state.items[state.pendingCursor], item)) {
    state.items[state.pendingCursor] = item;
    state.cursor = state.pendingCursor;
    state.pendingCursor = null;
    setRevision((value) => value + 1);
    return;
  }
  const current = state.items[state.cursor];
  if (sameLocation(current, item)) {
    state.items[state.cursor] = item;
    setRevision((value) => value + 1);
    return;
  }
  state.pendingCursor = null;
  state.items = state.items.slice(0, state.cursor + 1);
  state.items.push(item);
  if (state.items.length > MAX_HISTORY) state.items.splice(0, state.items.length - MAX_HISTORY);
  state.cursor = state.items.length - 1;
  setRevision((value) => value + 1);
}

export function canNavigateBack(collectionId: string): boolean {
  revision();
  const state = stateFor(collectionId);
  return state.cursor > 0;
}

export function canNavigateForward(collectionId: string): boolean {
  revision();
  const state = stateFor(collectionId);
  return state.cursor >= 0 && state.cursor < state.items.length - 1;
}

export function peekHistoryTarget(collectionId: string, direction: "back" | "forward"): NavigationItem | null {
  const state = stateFor(collectionId);
  const targetCursor = state.cursor + (direction === "back" ? -1 : 1);
  if (targetCursor < 0 || targetCursor >= state.items.length) return null;
  state.pendingCursor = targetCursor;
  return state.items[targetCursor] ?? null;
}

export function cancelHistoryNavigation(collectionId: string): void {
  const state = stateFor(collectionId);
  state.pendingCursor = null;
}

