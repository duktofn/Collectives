export type AnnouncementPriority = "polite" | "assertive";

export interface AnnouncementOptions {
  key: string;
  priority?: AnnouncementPriority;
  initial?: boolean;
}

export function announcementKey(operation: string, entry = "", cursor = ""): string {
  return [operation, entry, cursor].join("|");
}

const AUTOMATIC_NOISE = /^(saving|saved|unsaved changes|collection ready|no collection selected|keystroke|autosave)/i;

export function createAnnouncer() {
  let politeRegion: HTMLElement | null = null;
  let alertRegion: HTMLElement | null = null;
  let mounted = false;
  let lastKey = "";
  let lastMessage = "";

  const mount = (container: HTMLElement = document.body) => {
    if (mounted) return dispose;
    politeRegion = document.createElement("div");
    politeRegion.className = "ds-visually-hidden";
    politeRegion.setAttribute("aria-live", "polite");
    politeRegion.setAttribute("aria-atomic", "true");
    politeRegion.dataset.a11yAnnouncer = "polite";
    alertRegion = document.createElement("div");
    alertRegion.className = "ds-visually-hidden";
    alertRegion.setAttribute("role", "alert");
    alertRegion.setAttribute("aria-live", "assertive");
    alertRegion.setAttribute("aria-atomic", "true");
    alertRegion.dataset.a11yAnnouncer = "assertive";
    container.append(politeRegion, alertRegion);
    mounted = true;
    return dispose;
  };

  const announce = (message: string, options: AnnouncementOptions): boolean => {
    if (!mounted || !message.trim() || options.initial || AUTOMATIC_NOISE.test(message.trim())) return false;
    if (options.key === lastKey && message === lastMessage) return false;
    lastKey = options.key;
    lastMessage = message;
    const region = options.priority === "assertive" ? alertRegion : politeRegion;
    if (!region) return false;
    region.textContent = "";
    region.textContent = message;
    return true;
  };

  const polite = (message: string, key: string, initial = false) => announce(message, { key, initial, priority: "polite" });
  const alert = (message: string, key: string, initial = false) => announce(message, { key, initial, priority: "assertive" });
  const transition = (operation: string, entry: string, cursor: string, message: string, priority: AnnouncementPriority = "polite") => announce(message, { key: announcementKey(operation, entry, cursor), priority });

  const dispose = () => {
    politeRegion?.remove();
    alertRegion?.remove();
    politeRegion = null;
    alertRegion = null;
    mounted = false;
    lastKey = "";
    lastMessage = "";
  };

  return { mount, dispose, announce, polite, alert, transition };
}

export const announcer = createAnnouncer();

export function mountAnnouncer(container?: HTMLElement): () => void {
  return announcer.mount(container);
}
