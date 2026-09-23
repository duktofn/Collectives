export interface TreeKeyboardModelOptions {
  onFocusFallback?: (message: string) => void;
}

interface TreeRecord {
  element: HTMLElement;
  id: string;
  label: string;
  parentId: string | null;
  disabled: boolean;
}

export function treeItemIdentity(parts: Array<string | undefined | null>): string {
  return parts.filter((part): part is string => Boolean(part)).join(":");
}

export function normalizeTypeahead(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
}

function visibleRecords(root: HTMLElement): TreeRecord[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]')).filter((element) => {
    if (element.getAttribute("aria-disabled") === "true") return false;
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    const style = typeof window !== "undefined" ? window.getComputedStyle(element) : null;
    return style?.display !== "none" && style?.visibility !== "hidden";
  }).map((element) => ({
    element,
    id: element.dataset.treeItemId ?? "",
    label: element.dataset.treeLabel ?? element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "",
    parentId: element.dataset.treeParentId || null,
    disabled: element.getAttribute("aria-disabled") === "true",
  }));
}

function setTabStop(records: TreeRecord[], active: TreeRecord | undefined): void {
  for (const record of records) record.element.tabIndex = record === active ? 0 : -1;
}

function focusRecord(records: TreeRecord[], record: TreeRecord | undefined): void {
  if (!record) return;
  setTabStop(records, record);
  record.element.focus({ preventScroll: false });
}

function dispatchActivation(record: TreeRecord): void {
  record.element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
}

function dispatchContextMenu(record: TreeRecord): void {
  const rect = record.element.getBoundingClientRect();
  record.element.dispatchEvent(new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: Math.round(rect.left + Math.min(rect.width, 24)),
    clientY: Math.round(rect.top + Math.min(rect.height, 18)),
  }));
}

function isExpandable(record: TreeRecord): boolean {
  return record.element.hasAttribute("aria-expanded");
}

function firstChild(records: TreeRecord[], parentId: string): TreeRecord | undefined {
  return records.find((record) => record.parentId === parentId);
}

function parentRecord(records: TreeRecord[], record: TreeRecord): TreeRecord | undefined {
  return record.parentId ? records.find((candidate) => candidate.id === record.parentId) : undefined;
}

function focusFallback(root: HTMLElement, previous: TreeRecord[], records: TreeRecord[], options: TreeKeyboardModelOptions): TreeRecord | undefined {
  const active = document.activeElement?.closest<HTMLElement>('[role="treeitem"]');
  const previousActive = previous.find((record) => record.element === active || record.element.dataset.treeItemId === root.dataset.lastTreeFocus);
  if (!previousActive) return undefined;
  const oldIndex = previous.indexOf(previousActive);
  const sibling = records[Math.min(Math.max(oldIndex, 0), Math.max(records.length - 1, 0))];
  const parent = previousActive.parentId ? records.find((record) => record.id === previousActive.parentId) : undefined;
  const fallback = sibling ?? parent ?? records[0];
  if (fallback) {
    focusRecord(records, fallback);
    options.onFocusFallback?.(`Focused item ${previousActive.label || "entry"} is no longer available; focus moved to ${fallback.label || "the nearest entry"}.`);
  }
  return fallback;
}

export function normalizeTreeRovingTabindex(root: HTMLElement, preferredId?: string): void {
  const records = visibleRecords(root);
  const preferred = records.find((record) => record.id === preferredId);
  const current = records.find((record) => record.element.tabIndex === 0);
  setTabStop(records, preferred ?? current ?? records[0]);
}

export function installTreeKeyboardModel(root: HTMLElement, options: TreeKeyboardModelOptions = {}): () => void {
  let records = visibleRecords(root);
  let typeahead = "";
  let typeaheadTimer: ReturnType<typeof setTimeout> | undefined;
  root.dataset.lastTreeFocus = records.find((record) => record.element.tabIndex === 0)?.id ?? records[0]?.id ?? "";
  setTabStop(records, records.find((record) => record.id === root.dataset.lastTreeFocus) ?? records[0]);

  const reconcile = () => {
    const next = visibleRecords(root);
    const previousFocusedId = root.dataset.lastTreeFocus;
    if (previousFocusedId && !next.some((record) => record.id === previousFocusedId)) focusFallback(root, records, next, options);
    records = next;
    normalizeTreeRovingTabindex(root, root.dataset.lastTreeFocus);
  };

  const handleFocusIn = (event: FocusEvent) => {
    const item = (event.target as HTMLElement | null)?.closest<HTMLElement>('[role="treeitem"]');
    if (!item || !root.contains(item) || item.getAttribute("aria-disabled") === "true") return;
    root.dataset.lastTreeFocus = item.dataset.treeItemId ?? "";
    records = visibleRecords(root);
    setTabStop(records, records.find((record) => record.element === item));
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[role="treeitem"]');
    if (!target || !root.contains(target) || target.getAttribute("aria-disabled") === "true") return;
    records = visibleRecords(root);
    const current = records.find((record) => record.element === target);
    if (!current) return;
    const index = records.indexOf(current);
    const moveTo = (record: TreeRecord | undefined) => {
      if (!record) return;
      event.preventDefault();
      root.dataset.lastTreeFocus = record.id;
      focusRecord(records, record);
    };

    if (event.key === "ArrowDown") return moveTo(records[index + 1] ?? records[index]);
    if (event.key === "ArrowUp") return moveTo(records[index - 1] ?? records[index]);
    if (event.key === "Home") return moveTo(records[0]);
    if (event.key === "End") return moveTo(records[records.length - 1]);
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (isExpandable(current) && current.element.getAttribute("aria-expanded") !== "true") dispatchActivation(current);
      else moveTo(firstChild(records, current.id));
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (isExpandable(current) && current.element.getAttribute("aria-expanded") === "true") dispatchActivation(current);
      else moveTo(parentRecord(records, current));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      dispatchActivation(current);
      return;
    }
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      dispatchContextMenu(current);
      return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1 && !/\s/.test(event.key)) {
      event.preventDefault();
      typeahead += normalizeTypeahead(event.key);
      if (typeaheadTimer) clearTimeout(typeaheadTimer);
      typeaheadTimer = setTimeout(() => { typeahead = ""; }, 700);
      const wanted = normalizeTypeahead(typeahead);
      const ordered = [...records.slice(index + 1), ...records.slice(0, index + 1)];
      const match = ordered.find((record) => normalizeTypeahead(record.label).startsWith(wanted));
      moveTo(match);
    }
  };

  const observer = new MutationObserver(reconcile);
  root.addEventListener("focusin", handleFocusIn);
  root.addEventListener("keydown", handleKeyDown);
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-disabled", "aria-expanded", "hidden", "aria-hidden", "data-tree-label"] });
  return () => {
    if (typeaheadTimer) clearTimeout(typeaheadTimer);
    observer.disconnect();
    root.removeEventListener("focusin", handleFocusIn);
    root.removeEventListener("keydown", handleKeyDown);
  };
}
