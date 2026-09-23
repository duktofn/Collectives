import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

afterEach(cleanup);

it("blocks Enter, Escape and backdrop dismissal while pending, then permits close", () => {
  const [pending, setPending] = createSignal(true);
  const close = vi.fn();
  const confirm = vi.fn();
  render(() => <Dialog isOpen title="Import" type="input" pending={pending()} onClose={close} onConfirm={confirm} />);
  const input = screen.getByRole("textbox");
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Escape" });
  fireEvent.click(document.querySelector("[data-modal-layer]")!);
  expect(confirm).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  setPending(false);
  fireEvent.click(document.querySelector("[data-modal-layer]")!);
  expect(close).toHaveBeenCalledOnce();
});
