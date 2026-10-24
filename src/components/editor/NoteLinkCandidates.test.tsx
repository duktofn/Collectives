import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteLinkCandidates } from "./NoteLinkCandidates";
import type { NoteLinkNavigationRequest } from "../../features/links/noteLinkContext";

afterEach(cleanup);

function mountPicker(pending = false) {
  const request: NoteLinkNavigationRequest = {
    contextId: "picker-test", requestId: 1, collectionId: "collection",
    sourcePath: "C:/notes/Source.md", sourceEntryId: "source-entry",
    sessionKey: "session", noteName: "Note",
    candidates: [
      { displayName: "Note", entryId: "first", path: "C:/notes/first/Note.md", entryType: "file" },
      { displayName: "Note", entryId: "second", path: "C:/notes/second/Note.md", entryType: "file" },
    ],
    fragment: { type: "heading", value: "Target" },
    isCurrent: () => true, restoreFocus: vi.fn(), claim: () => true,
    accept: () => true, settle: vi.fn(),
  };
  const onSelect = vi.fn();
  const onCancel = vi.fn();
  render(() => <NoteLinkCandidates request={request} pending={pending} onSelect={onSelect} onCancel={onCancel} />);
  return { request, onSelect, onCancel };
}

describe("note-link candidate keyboard interaction", () => {
  it("exposes every distinct path as an option owned by the matching-notes listbox", () => {
    mountPicker();
    const listbox = screen.getByRole("listbox", { name: "Matching notes" });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    for (const option of options) expect(option.closest('[role="listbox"]')).toBe(listbox);
    expect(options[0].textContent).toContain("C:/notes/first/Note.md");
    expect(options[1].textContent).toContain("C:/notes/second/Note.md");
  });

  it("moves among candidates with arrows/Home/End and selects the focused candidate once", async () => {
    const { request, onSelect, onCancel } = mountPicker();
    const options = screen.getAllByRole("option");
    await waitFor(() => expect(document.activeElement).toBe(options[0]));
    fireEvent.keyDown(options[0], { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(options[1]));
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(options[1], { key: "Home" });
    await waitFor(() => expect(document.activeElement).toBe(options[0]));
    fireEvent.keyDown(options[0], { key: "End" });
    await waitFor(() => expect(document.activeElement).toBe(options[1]));
    fireEvent.keyDown(options[1], { key: "Enter" });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(request.candidates[1]);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("does not reinterpret Enter on Cancel as choosing a note", () => {
    const { onSelect, onCancel } = mountPicker();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
    // jsdom does not synthesize a button's native click from keyboard events.
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("lets Escape cancel navigation even while target readiness is pending", () => {
    const { onSelect, onCancel } = mountPicker(true);
    const cancel = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(false);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
