/** Keep browser inspection shortcuts and the native browser menu out of release builds. */
export function installReleaseGuards(target: Document = document): () => void {
  const blockInspection = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    const command = event.ctrlKey || event.metaKey;
    const inspection =
      key === 'f12' ||
      (command && key === 'u') ||
      (command && event.shiftKey && ['i', 'j', 'c', 'k'].includes(key)) ||
      (event.metaKey && event.altKey && ['i', 'j', 'c'].includes(key));
    if (!inspection) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  // App context menus run on their own elements before this bubbling listener.
  const blockBrowserMenu = (event: MouseEvent) => event.preventDefault();
  target.addEventListener('keydown', blockInspection, true);
  target.addEventListener('contextmenu', blockBrowserMenu);
  return () => {
    target.removeEventListener('keydown', blockInspection, true);
    target.removeEventListener('contextmenu', blockBrowserMenu);
  };
}
