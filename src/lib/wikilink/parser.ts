import { WikilinkToken } from "../../types";

export function parseWikilink(raw: string): WikilinkToken | null {
  const regex = /^\[\[([^\]#]+?)(?:#(?:\^([a-zA-Z0-9]+)|([^\]]+)))?\]\]$/;
  const match = raw.match(regex);
  if (!match) return null;

  let noteName = match[1].trim();
  if (!noteName) return null;

  // Strip trailing .md case-insensitive
  if (noteName.toLowerCase().endsWith(".md")) {
    noteName = noteName.slice(0, -3).trim();
  }
  if (!noteName) return null;

  let fragment = null;
  if (match[2]) {
    fragment = {
      type: "block" as const,
      value: match[2].trim(),
    };
  } else if (match[3]) {
    fragment = {
      type: "heading" as const,
      value: match[3].trim(),
    };
  }

  return {
    raw,
    noteName,
    fragment,
  };
}

export function serializeWikilink(token: Omit<WikilinkToken, "raw">): string {
  let res = `[[${token.noteName}`;
  if (token.fragment) {
    if (token.fragment.type === "block") {
      res += `#^${token.fragment.value}`;
    } else {
      res += `#${token.fragment.value}`;
    }
  }
  res += "]]";
  return res;
}
