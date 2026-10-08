import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { ModalLayer } from "./ModalLayer";
import { Dialog } from "./Dialog";

function ModalHarness() {
  const [open, setOpen] = createSignal(true);
  return (
    <div data-app-shell-root="true">
      <button id="opener" onClick={() => setOpen(true)}>Open</button>
      <ModalLayer isOpen={open()} labelledBy="modal-title" onClose={() => setOpen(false)}>
        <h2 id="modal-title">Example dialog</h2>
        <button data-modal-initial-focus="true">First</button>
        <button>Last</button>
      </ModalLayer>
    </div>
  );
}

describe("ModalLayer focus and accessibility baseline", () => {
  it("inerts the app root, focuses the initial control, wraps Tab and restores the opener", async () => {
    const { container } = render(() => <ModalHarness />);
    const root = container.querySelector("[data-app-shell-root]") as HTMLElement;
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    const buttons = Array.from(dialog.querySelectorAll("button"));
    await Promise.resolve();

    expect(root.hasAttribute("inert")).toBe(true);
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(document.activeElement).toBe(buttons[0]);

    buttons[1].focus();
    fireEvent.keyDown(buttons[1], { key: "Tab" });
    expect(document.activeElement).toBe(buttons[0]);

    buttons[0].focus();
    fireEvent.keyDown(buttons[0], { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(buttons[1]);

    fireEvent.keyDown(buttons[1], { key: "Escape" });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(root.hasAttribute("inert")).toBe(false);
    expect(root.hasAttribute("aria-hidden")).toBe(false);
  });

  it("restores focus to a safe fallback when the opener is removed", async () => {
    const [open, setOpen] = createSignal(false);
    const { container } = render(() => (
      <div data-app-shell-root="true">
        <button id="temporary-opener" onClick={() => setOpen(true)}>Open</button>
        <button id="safe-fallback">Safe fallback</button>
        <ModalLayer isOpen={open()} labelledBy="fallback-title" onClose={() => setOpen(false)}>
          <h2 id="fallback-title">Fallback dialog</h2>
          <button data-modal-initial-focus="true">Close</button>
        </ModalLayer>
      </div>
    ));
    const opener = container.querySelector("#temporary-opener") as HTMLElement;
    opener.focus();
    fireEvent.click(opener);
    const dialogButton = document.body.querySelector('[role="dialog"] button') as HTMLElement;
    await Promise.resolve();
    opener.remove();
    fireEvent.keyDown(dialogButton, { key: "Escape" });
    expect(document.activeElement?.id).toBe("safe-fallback");
  });

  it("keeps the app root inert until the last modal in the stack closes", () => {
    const [firstOpen, setFirstOpen] = createSignal(true);
    const [secondOpen, setSecondOpen] = createSignal(true);
    const { container } = render(() => (
      <div data-app-shell-root="true">
        <button>Background</button>
        <ModalLayer isOpen={firstOpen()} labelledBy="first-title" onClose={() => setFirstOpen(false)}>
          <h2 id="first-title">First</h2>
          <button>Close first</button>
        </ModalLayer>
        <ModalLayer isOpen={secondOpen()} labelledBy="second-title" onClose={() => setSecondOpen(false)}>
          <h2 id="second-title">Second</h2>
          <button>Close second</button>
        </ModalLayer>
      </div>
    ));
    const root = container.querySelector("[data-app-shell-root]") as HTMLElement;
    const dialogs = Array.from(document.body.querySelectorAll('[role="dialog"]'));
    expect(dialogs).toHaveLength(2);
    expect(root.hasAttribute("inert")).toBe(true);
    fireEvent.keyDown(dialogs[1], { key: "Escape" });
    expect(root.hasAttribute("inert")).toBe(true);
    fireEvent.keyDown(dialogs[0], { key: "Escape" });
    expect(root.hasAttribute("inert")).toBe(false);
  });

  it("gives the generic dialog a unique labelled modal surface", () => {
    render(() => (
      <div data-app-shell-root="true">
        <Dialog isOpen title="Create collection" type="confirm" onConfirm={() => undefined} onClose={() => undefined} />
        <Dialog isOpen title="Second dialog" type="confirm" onConfirm={() => undefined} onClose={() => undefined} />
      </div>
    ));
    const dialogs = screen.getAllByRole("dialog");
    const labels = dialogs.map((dialog) => dialog.getAttribute("aria-labelledby"));
    expect(new Set(labels).size).toBe(2);
    for (const label of labels) {
      expect(label).toBeTruthy();
      expect(document.getElementById(label as string)).not.toBeNull();
    }
  });
});