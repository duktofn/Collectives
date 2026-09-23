import { afterEach, describe, expect, it } from "vitest";
import { installTreeKeyboardModel, normalizeTypeahead, treeItemIdentity } from "./treeAccessibility";
import { isFolderRefChildOpen } from "./FolderRefChildRow";

describe("tree keyboard model", () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    document.body.innerHTML = "";
  });

  it("normalizes stable identities and diacritic-insensitive labels", () => {
    expect(treeItemIdentity(["folderref", "entry", "C:\\Notes\\Élan.md"])).toBe("folderref:entry:C:\\Notes\\Élan.md");
    expect(normalizeTypeahead("Élan")).toBe("elan");
  });

  it("exposes at most one ready FolderRef child as selected by actual open identity", () => {
    const children = ["/notes/a.md", "/notes/b.md", "/notes/c.md"];
    const selected = children.filter((path) => isFolderRefChildOpen(path, "/notes/b.md", "/notes/b.md"));
    expect(selected).toEqual(["/notes/b.md"]);
    expect(children.filter((path) => isFolderRefChildOpen(path, "/notes/missing.md", null))).toHaveLength(0);
  });

  it("keeps exactly one enabled treeitem in the roving tab order and moves without selecting", () => {
    document.body.innerHTML = `
      <div id="tree" role="tree">
        <div role="treeitem" data-tree-item-id="a" data-tree-label="Álpha" tabindex="0"></div>
        <div role="treeitem" data-tree-item-id="b" data-tree-label="Beta" tabindex="-1"></div>
        <div role="treeitem" data-tree-item-id="disabled" aria-disabled="true" data-tree-label="Disabled" tabindex="-1"></div>
      </div>`;
    const root = document.querySelector<HTMLDivElement>("#tree");
    if (!root) throw new Error("tree fixture missing");
    dispose = installTreeKeyboardModel(root);
    const items = root.querySelectorAll<HTMLElement>('[role="treeitem"]');
    items[0].focus();
    items[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(items[1]);
    expect(Array.from(items).filter((item) => item.tabIndex === 0)).toHaveLength(1);
    items[1].dispatchEvent(new KeyboardEvent("keydown", { key: "á", bubbles: true }));
    expect(document.activeElement).toBe(items[0]);
    expect(items[0].getAttribute("aria-selected")).toBeNull();
  });
});
