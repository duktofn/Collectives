import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

afterEach(cleanup);

describe("Sidebar accessibility contract", () => {
  it("uses a labelled collection button and keeps actions outside the listbox", () => {
    render(() => (
      <Sidebar
        onNewNoteClick={vi.fn()}
        recoveryDraftCount={0}
        onReviewRecovery={vi.fn()}
        onNewCollectionClick={vi.fn()}
        onImportFolderClick={vi.fn()}
        onImportZipClick={vi.fn()}
        onSettingsClick={vi.fn()}
        requestSelect={vi.fn(async () => true)}
        requestFolderRefSelect={vi.fn(async () => true)}
        requestSwitch={vi.fn(async () => true)}
        onReviewMovePrompt={vi.fn()}
      />
    ));
    const trigger = document.querySelector<HTMLButtonElement>('[aria-label="Choose collection"]');
    expect(trigger?.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger!);
    expect(document.querySelector('[role="listbox"]')).toBeTruthy();
    expect(document.querySelectorAll('[role="listbox"] [role="option"]')).toHaveLength(0);
    expect(document.querySelector('[aria-label="New Collection"]')?.closest('[role="listbox"]')).toBeNull();
  });
});
