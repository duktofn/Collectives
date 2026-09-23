import { fireEvent, render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { FileVisibilityPreference } from "./FileVisibilityPreference";
import { uiStore } from "../../stores/ui";

describe("file visibility preference", () => {
  it("is UI-only and persists under the dedicated ui key", async () => {
    uiStore.setHideUnsupportedFiles(false);
    const view = render(() => <FileVisibilityPreference />);
    const checkbox = view.getByRole("checkbox") as HTMLInputElement;
    await fireEvent.click(checkbox);
    expect(uiStore.state.hideUnsupportedFiles).toBe(true);
    expect(localStorage.getItem("collectives.hideUnsupportedFiles.v1")).toBe("true");
    uiStore.setHideUnsupportedFiles(false);
  });
});
