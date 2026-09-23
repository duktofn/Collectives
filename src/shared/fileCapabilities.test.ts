import { describe, expect, it } from "vitest";
import { classifyFilePath, FILE_PICKER_EXTENSIONS, isSupportedFilePath } from "./fileCapabilities.generated";

describe("Feature 4.2 generated file capabilities", () => {
  it("uses the canonical lower-case policy for markdown and text-source files", () => {
    expect(classifyFilePath("note.MARKDOWN")).toBe("markdown");
    expect(classifyFilePath("config.JSON")).toBe("text-source");
    expect(classifyFilePath("README")).toBeNull();
    expect(isSupportedFilePath("file.tsx")).toBe(true);
    expect(FILE_PICKER_EXTENSIONS).toContain("markdown");
    expect(FILE_PICKER_EXTENSIONS).toContain("json");
  });
});
