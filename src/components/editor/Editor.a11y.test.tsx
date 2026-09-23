import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "./Editor";

afterEach(cleanup);

describe("Editor accessibility contract", () => {
  it("describes the CodeMirror textbox without replacing its native semantics", () => {
    render(() => <Editor />);
    const editor = document.querySelector<HTMLElement>(".cm-content");
    expect(editor).toBeTruthy();
    expect(editor?.getAttribute("aria-label")).toMatch(/untitled document/);
    expect(editor?.getAttribute("aria-describedby")).toMatch(/^editor-help-/);
    expect(editor?.getAttribute("aria-readonly")).toBe("false");
    expect(document.getElementById(editor?.getAttribute("aria-describedby") ?? "")?.classList.contains("ds-visually-hidden")).toBe(true);
  });
});
