import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";

afterEach(cleanup);

describe("ContextMenu accessibility contract", () => {
  it("exposes menu semantics, keyboard navigation and one activation", async () => {
    const action = vi.fn();
    const close = vi.fn();
    render(() => <ContextMenu x={0} y={0} isOpen={true} onClose={close} items={[{ label: "Open", onClick: action }, { label: "Delete", danger: true, onClick: vi.fn(), separatorBefore: true }]} />);
    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
    expect(menu.querySelector('[role="separator"]')).toBeTruthy();
    const first = menu.querySelector('[role="menuitem"]') as HTMLElement;
    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });
    fireEvent.keyDown(first, { key: "Enter" });
    expect(action).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("restores a disconnected opener through a valid filtered fallback", async () => {
    const close = vi.fn();
    const [open, setOpen] = createSignal(true);
    render(() => (
      <div role="tree">
        <div role="treeitem" tabIndex={0}>Fallback</div>
        <ContextMenu x={0} y={0} isOpen={open()} onClose={() => { close(); setOpen(false); }} items={[{ label: "Open", onClick: vi.fn() }]} />
      </div>
    ));
    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    opener.remove();
    expect(() => fireEvent.keyDown(menu, { key: "Escape" })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(close).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.textContent).toBe("Fallback");
  });

  it("does not steal focus from a move-to radio dialog when the menu closes", async () => {
    const [open, setOpen] = createSignal(true);
    const modalButton = document.createElement("button");
    modalButton.textContent = "Destination";
    modalButton.dataset.modalFocusScope = "true";
    document.body.append(modalButton);
    const action = () => modalButton.focus();
    render(() => <ContextMenu x={0} y={0} isOpen={open()} onClose={() => setOpen(false)} items={[{ label: "Move to...", onClick: action }]} />);
    const item = document.querySelector('[role="menuitem"]') as HTMLElement;
    fireEvent.click(item);
    await Promise.resolve();
    await Promise.resolve();
    expect(document.activeElement).toBe(modalButton);
    modalButton.remove();
  });
});
