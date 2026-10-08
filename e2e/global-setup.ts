import type { FullConfig } from "@playwright/test";

export default async function warmEditorFixtureModules(_config: FullConfig): Promise<void> {
  const base = "http://127.0.0.1:4174";
  const modules = [
    "/e2e/editor-interaction.html",
    "/src/styles/variables.css",
    "/src/components/editor/Editor.css",
    "/src/visual-fixtures/editorCodeBlockFixture.ts",
    "/src/visual-fixtures/editorHistoryFixture.ts",
    "/src/visual-fixtures/editorTableFixture.ts",
  ];

  for (const path of modules) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(120_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await response.arrayBuffer();
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    if (lastError) throw new Error(`Could not warm ${path}: ${String(lastError)}`);
  }
}
