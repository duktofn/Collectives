import { describe, expect, it } from "vitest";
import { getDelimiterEdit } from "./delimiter-pairs";

describe("shared Markdown delimiter input rules", () => {
  it("pairs supported delimiters, wraps selections, and overtypes an existing close", () => {
    expect(getDelimiterEdit("", 0, 0, "\"")).toMatchObject({ insert: "\"\"", cursor: 1 });
    expect(getDelimiterEdit("selected", 0, 8, "*")).toMatchObject({ insert: "*selected*", cursor: 9 });
    expect(getDelimiterEdit("(value)", 6, 6, ")")).toMatchObject({ insert: "", cursor: 7, overtype: true });
  });

  it("expands an empty italic pair into bold and keeps wikilink brackets intact", () => {
    expect(getDelimiterEdit("**", 1, 1, "*")).toMatchObject({ from: 1, to: 2, insert: "***", cursor: 2 });
    expect(getDelimiterEdit("**bold**", 7, 7, "*")).toMatchObject({ insert: "", cursor: 8, overtype: true });
    expect(getDelimiterEdit("[]", 1, 1, "[")).toMatchObject({ insert: "[", cursor: 2 });
  });

  it("does not pair apostrophes inside words or escaped delimiters", () => {
    expect(getDelimiterEdit("dont", 3, 3, "'")).toBeNull();
    expect(getDelimiterEdit("\\", 1, 1, "\"")).toBeNull();
    expect(getDelimiterEdit("''", 1, 1, "'")).toMatchObject({ insert: "", overtype: true });
    expect(getDelimiterEdit("\\**", 2, 2, "*")).toMatchObject({ insert: "", overtype: true });
  });
  it("inserts only a closer for unmatched formatting, then pairs after closed spans", () => {
    for (const [text, marker] of [["*italic", "*"], ["**bold", "*"], ["**bold*", "*"],
      ["_italic", "_"], ["__bold_", "_"], ["~~strike~", "~"], ["`code", "`"], ["``code`", "`"],
      ['"quote', '"']]) {
      expect(getDelimiterEdit(text, text.length, text.length, marker), text).toBeNull();
    }
    for (const [text, marker] of [["*italic* ", "*"], ["**bold** ", "*"], ["_italic_ ", "_"],
      ["~~strike~~ ", "~"], ["`code` ", "`"], ["``one`two`` ", "`"], ["`literal*` ", "*"], ["* list item ", "*"]]) {
      expect(getDelimiterEdit(text, text.length, text.length, marker), text)?.toMatchObject({ insert: marker + marker });
    }
    expect(getDelimiterEdit("__", 1, 1, "_")?.insert).toBe("___");
    expect(getDelimiterEdit("~~", 1, 1, "~")?.insert).toBe("~~~");
  });

});
