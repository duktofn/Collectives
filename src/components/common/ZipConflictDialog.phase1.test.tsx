import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { ZipConflictDialog } from "./ZipConflictDialog";

describe("Phase 1 ZIP conflict resolution", () => {
  it("keeps the ZIP surface labelled as a modal dialog", () => {
    render(() => <ZipConflictDialog isOpen conflicts={[]} onConfirm={() => undefined} onClose={() => undefined} />);
    const dialog = screen.getByRole("dialog");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)?.textContent).toContain("Resolve ZIP Import Conflicts");
  });

  it("does not confirm until every conflict has an explicit resolution", async () => {
    const onConfirm = vi.fn();
    render(() => <ZipConflictDialog isOpen conflicts={[{ conflictId: "c1", entryId: "e1", displayName: "note", targetPath: "dest/note.md", originMembers: ["assets/note.md"], allowedResolutions: ["rename", "skip"], kind: "internal-collision" }]} onConfirm={onConfirm} onClose={() => undefined} />);
    await fireEvent.click(screen.getByText("Confirm Import"));
    expect(onConfirm).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByText("Rename"));
    await fireEvent.click(screen.getByText("Confirm Import"));
    expect(onConfirm).toHaveBeenCalledWith({ c1: "rename" });
  });
});
