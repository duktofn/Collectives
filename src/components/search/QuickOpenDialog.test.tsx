import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuickOpenDialog } from "./QuickOpenDialog";
import type { ResolveCandidate } from "../../types";
import { searchLinkIndex } from "../../features/links";
vi.mock("../../features/links", () => ({ searchLinkIndex: vi.fn(async () => []) }));

afterEach(cleanup);

const item = (displayName: string, entryId: string): ResolveCandidate => ({
  displayName,
  entryId,
  path: `C:/notes/${displayName}.md`,
  entryType: "file",
});

describe("Quick Open", () => {
  it("opens the active result with arrows and Enter", async () => {
    const first = item("First", "first");
    const second = item("Second", "second");
    const onOpen = vi.fn(async () => true);
    const onClose = vi.fn();
    vi.mocked(searchLinkIndex).mockResolvedValue([first, second]);
    render(() => (
      <QuickOpenDialog isOpen={true} collectionId="collection" onClose={onClose} onOpen={onOpen} />
    ));
    const input = screen.getByRole("combobox", { name: "Search note names" });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(second));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

