import hljs from "highlight.js/lib/core";
import type { LanguageFn } from "highlight.js";

const languageLoaders: Record<string, () => Promise<LanguageFn>> = {
  javascript: () => import("highlight.js/lib/languages/javascript").then((module) => module.default),
  typescript: () => import("highlight.js/lib/languages/typescript").then((module) => module.default),
  python: () => import("highlight.js/lib/languages/python").then((module) => module.default),
  rust: () => import("highlight.js/lib/languages/rust").then((module) => module.default),
  css: () => import("highlight.js/lib/languages/css").then((module) => module.default),
  xml: () => import("highlight.js/lib/languages/xml").then((module) => module.default),
  json: () => import("highlight.js/lib/languages/json").then((module) => module.default),
  bash: () => import("highlight.js/lib/languages/bash").then((module) => module.default),
  sql: () => import("highlight.js/lib/languages/sql").then((module) => module.default),
  java: () => import("highlight.js/lib/languages/java").then((module) => module.default),
  cpp: () => import("highlight.js/lib/languages/cpp").then((module) => module.default),
  csharp: () => import("highlight.js/lib/languages/csharp").then((module) => module.default),
  go: () => import("highlight.js/lib/languages/go").then((module) => module.default),
  php: () => import("highlight.js/lib/languages/php").then((module) => module.default),
  ruby: () => import("highlight.js/lib/languages/ruby").then((module) => module.default),
  swift: () => import("highlight.js/lib/languages/swift").then((module) => module.default),
  kotlin: () => import("highlight.js/lib/languages/kotlin").then((module) => module.default),
  yaml: () => import("highlight.js/lib/languages/yaml").then((module) => module.default),
  markdown: () => import("highlight.js/lib/languages/markdown").then((module) => module.default),
  lua: () => import("highlight.js/lib/languages/lua").then((module) => module.default),
  dart: () => import("highlight.js/lib/languages/dart").then((module) => module.default),
  diff: () => import("highlight.js/lib/languages/diff").then((module) => module.default),
  plaintext: () => import("highlight.js/lib/languages/plaintext").then((module) => module.default),
  ini: () => import("highlight.js/lib/languages/ini").then((module) => module.default),
  scss: () => import("highlight.js/lib/languages/scss").then((module) => module.default),
};

const aliases: Record<string, string> = {
  js: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript",
  py: "python",
  rs: "rust",
  html: "xml",
  sh: "bash", zsh: "bash", shell: "bash",
  c: "cpp",
  cs: "csharp",
  golang: "go",
  rb: "ruby",
  kt: "kotlin",
  yml: "yaml",
  md: "markdown",
  text: "plaintext", txt: "plaintext",
  toml: "ini",
  sass: "scss",
};

const loadPromises = new Map<string, Promise<void>>();
const aliasesByLanguage = new Map<string, string[]>();
for (const [alias, language] of Object.entries(aliases)) {
  const names = aliasesByLanguage.get(language) ?? [];
  names.push(alias);
  aliasesByLanguage.set(language, names);
}

async function ensureLanguage(language: string): Promise<string | null> {
  const requested = language.toLowerCase().trim();
  const canonical = aliases[requested] ?? requested;
  const loader = languageLoaders[canonical];
  if (!loader) return null;
  if (!hljs.getLanguage(requested)) {
    let pending = loadPromises.get(canonical);
    if (!pending) {
      pending = loader().then((languageDefinition) => {
        hljs.registerLanguage(canonical, languageDefinition);
        for (const alias of aliasesByLanguage.get(canonical) ?? []) {
          hljs.registerLanguage(alias, languageDefinition);
        }
      }).finally(() => loadPromises.delete(canonical));
      loadPromises.set(canonical, pending);
    }
    await pending;
  }
  return hljs.getLanguage(requested) ? requested : canonical;
}

/**
 * Returns highlighted HTML when a grammar is already loaded, otherwise safe
 * escaped text. Widgets call the async variant so language code stays out of
 * the startup bundle and parsing does not block editor construction.
 */
export function highlightCode(code: string, language: string): string {
  if (!code) return "";
  const lang = language.toLowerCase().trim();
  if (!lang || !hljs.getLanguage(lang)) return escapeHtml(code);
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

export async function highlightCodeAsync(code: string, language: string): Promise<string> {
  if (!code) return "";
  // Very large snippets remain readable without making a grammar parse a long task.
  if (code.length > 120_000) return escapeHtml(code);
  try {
    const resolvedLanguage = await ensureLanguage(language);
    return resolvedLanguage ? highlightCode(code, resolvedLanguage) : escapeHtml(code);
  } catch {
    return escapeHtml(code);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
