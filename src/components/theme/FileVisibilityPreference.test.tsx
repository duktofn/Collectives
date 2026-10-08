import { fireEvent, render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { FileVisibilityPreference } from "./FileVisibilityPreference";

describe("file visibility preference", () => {
  it("reports draft changes without saving them immediately", async () => {
    let hidden = false;
    const previous = localStorage.getItem("collectives.hideUnsupportedFiles.v1");
    const view = render(() => <FileVisibilityPreference checked={hidden} onChange={(value) => { hidden = value; }} />);
    const checkbox = view.getByRole("checkbox") as HTMLInputElement;
    await fireEvent.click(checkbox);
    expect(hidden).toBe(true);
    expect(localStorage.getItem("collectives.hideUnsupportedFiles.v1")).toBe(previous);
  });
});
