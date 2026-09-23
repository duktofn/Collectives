import { createEffect, onCleanup } from "solid-js";

let activeModalCount = 0;
let previousRootInert = false;
let previousRootHidden: string | null = null;

function modalRoot(): HTMLElement | null {
  return document.querySelector("[data-app-shell-root]") ?? document.getElementById("root");
}

function acquireModalRoot() {
  const root = modalRoot();
  if (activeModalCount === 0 && root) {
    previousRootInert = root.hasAttribute("inert") || root.inert === true;
    previousRootHidden = root.getAttribute("aria-hidden");
    root.inert = true;
    root.setAttribute("inert", "");
    root.setAttribute("aria-hidden", "true");
  }
  activeModalCount += 1;
}

function releaseModalRoot() {
  activeModalCount = Math.max(0, activeModalCount - 1);
  if (activeModalCount !== 0) return;
  const root = modalRoot();
  if (!root) return;
  root.inert = previousRootInert;
  if (previousRootInert) root.setAttribute("inert", "");
  else root.removeAttribute("inert");
  if (previousRootHidden === null) root.removeAttribute("aria-hidden");
  else root.setAttribute("aria-hidden", previousRootHidden);
}

function focusableElements(scope: HTMLElement): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(
    "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])"
  )).filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
}

function focusFallback() {
  const root = modalRoot();
  const fallback = root?.querySelector<HTMLElement>("button:not([disabled]), [tabindex]:not([tabindex=\"-1\"])") ?? document.body;
  fallback.focus?.();
}

export function createModalFocusController(isOpen: () => boolean, onEscape: () => void) {
  let scope: HTMLDivElement | undefined;
  let opener: HTMLElement | null = null;
  let active = false;

  const focusInitial = () => {
    if (!scope) return;
    const initial = scope.querySelector<HTMLElement>("[data-modal-initial-focus], [autofocus]") ?? focusableElements(scope)[0];
    (initial ?? scope).focus();
  };

  const restoreFocus = () => {
    if (opener?.isConnected && !opener.hasAttribute("disabled")) opener.focus();
    else focusFallback();
    opener = null;
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onEscape();
      return;
    }
    if (event.key !== "Tab" || !scope) return;
    const elements = focusableElements(scope);
    if (elements.length === 0) {
      event.preventDefault();
      scope.focus();
      return;
    }
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  createEffect(() => {
    if (isOpen() && !active) {
      active = true;
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      acquireModalRoot();
      queueMicrotask(focusInitial);
    } else if (!isOpen() && active) {
      active = false;
      releaseModalRoot();
      restoreFocus();
    }
  });

  onCleanup(() => {
    if (active) {
      active = false;
      releaseModalRoot();
      restoreFocus();
    }
  });

  return {
    attach(element: HTMLDivElement) {
      scope = element;
    },
    handleKeyDown,
  };
}
