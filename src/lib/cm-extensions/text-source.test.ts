import { describe, expect, it } from "vitest";
import { getBaseExtensionsForFile, getExtensionsForMode } from "./markdown-mode";
import { EditorState } from "@codemirror/state";

describe("text-source editor mode", () => {
  it("honors read-only view mode for text-source documents", () => {
    const state = EditorState.create({ extensions: getExtensionsForMode("view", "text-source") });
    expect(state.readOnly).toBe(true);
  });
  it("uses source-only extensions without markdown/render widgets", () => {
    const source = getExtensionsForMode("edit-render", "text-source");
    expect(source).toHaveLength(3);
    expect(getBaseExtensionsForFile("text-source")).not.toBe(getBaseExtensionsForFile("markdown"));
  });
});
