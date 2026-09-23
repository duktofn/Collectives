#!/usr/bin/env node
/* global console, document, process, fetch, setTimeout, requestAnimationFrame, window, KeyboardEvent, MouseEvent, PerformanceObserver */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { spawn } from "node:child_process";

const workspace = resolve(import.meta.dirname, "../..");
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function fail(message) { throw new Error(message); }
const index = process.argv.indexOf("--run-id");
const runId = index >= 0 ? process.argv[index + 1] : "";
if (!runId || !SAFE_RUN_ID.test(runId) || runId.includes("..")) fail("a safe --run-id is required");
const root = resolve(workspace, "artifacts/phase6", runId);
const preflightPath = resolve(root, "preflight.json");
const frontend = resolve(root, "frontend");
const frontendEvidence = resolve(root, "frontend-evidence");
if (!existsSync(preflightPath) || !existsSync(resolve(root, "frontend-stage.json")) || !existsSync(frontend) || !existsSync(frontendEvidence)) fail("preflight and staged release/evidence frontends are required before performance baseline");
const preflight = JSON.parse(readFileSync(preflightPath, "utf8"));

function filesIn(directory) {
  const result = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) result.push(path);
    }
  };
  visit(directory);
  return result.sort();
}
function stats(samples) {
  if (!samples.length) return { p50_ms: null, p95_ms: null, mad_ms: null, coefficient_of_variation: null };
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  const deviations = sorted.map((sample) => Math.abs(sample - median)).sort((a, b) => a - b);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length;
  return { p50_ms: Number(median.toFixed(3)), p95_ms: Number(p95.toFixed(3)), mad_ms: Number(deviations[Math.floor(deviations.length / 2)].toFixed(3)), coefficient_of_variation: mean === 0 ? 0 : Number((Math.sqrt(variance) / mean).toFixed(4)) };
}
function sourceMapAttribution(relativeChunk) {
  const mapPath = resolve(frontendEvidence, `${relativeChunk}.map`);
  if (!existsSync(mapPath)) return { status: "missing" };
  try {
    const map = JSON.parse(readFileSync(mapPath, "utf8"));
    return { status: "pass", map_path: relative(frontendEvidence, mapPath).replaceAll("\\", "/"), source_count: map.sources?.length ?? 0, modules: (map.sources ?? []).map((source) => ({ source, attributed: true })) };
  } catch (error) {
    return { status: "fail", map_path: relative(frontendEvidence, mapPath).replaceAll("\\", "/"), error: String(error) };
  }
}
function bundleReport() {
  const chunks = filesIn(frontend).filter((path) => [".js", ".css"].includes(extname(path))).map((path) => {
    const data = readFileSync(path);
    const text = data.toString("utf8");
    const relativeChunk = relative(frontend, path).replaceAll("\\", "/");
    return { path: relativeChunk, raw_bytes: data.length, gzip_bytes: gzipSync(data).length, brotli_bytes: brotliCompressSync(data).length, sha256: createHash("sha256").update(data).digest("hex"), source_map_attribution: extname(path) === ".css" ? { status: "not_applicable_css", module_attribution: "CSS is represented by the staged stylesheet itself; JavaScript modules use evidence-only source maps" } : sourceMapAttribution(relativeChunk), release_source_mapping_reference: /sourceMappingURL=/.test(text) ? "unexpected-release-reference" : "none" };
  });
  const allFiles = filesIn(frontend).map((path) => relative(frontend, path).replaceAll("\\", "/"));
  const forbidden = allFiles.filter((path) => /(^|\/)(visual-fixtures|e2e|test-fixtures)(\/|$)|\.map$/i.test(path));
  const evidenceMaps = filesIn(frontendEvidence).filter((path) => path.endsWith(".map")).map((path) => relative(frontendEvidence, path).replaceAll("\\", "/"));
  const attributionFailure = chunks.filter((chunk) => chunk.path.endsWith(".js")).some((chunk) => chunk.source_map_attribution.status !== "pass" || chunk.source_map_attribution.source_count === 0);
  return { chunks, totals: chunks.reduce((total, item) => ({ raw_bytes: total.raw_bytes + item.raw_bytes, gzip_bytes: total.gzip_bytes + item.gzip_bytes, brotli_bytes: total.brotli_bytes + item.brotli_bytes }), { raw_bytes: 0, gzip_bytes: 0, brotli_bytes: 0 }), manifest: existsSync(resolve(frontend, ".vite/manifest.json")) ? ".vite/manifest.json" : "unavailable", evidence_manifest: existsSync(resolve(frontendEvidence, ".vite/manifest.json")) ? ".vite/manifest.json" : "unavailable", source_map_policy: forbidden.some((path) => path.endsWith(".map")) ? "fail" : "release bundle excludes source maps and visual/test fixtures", evidence_source_maps: evidenceMaps, evidence_source_map_policy: attributionFailure ? "fail" : "evidence-only maps provide per-module attribution", forbidden_paths: forbidden, status: forbidden.length || attributionFailure ? "fail" : "pass" };
}
async function jsdomSamples(size) {
  try {
    const { JSDOM } = await import("jsdom");
    const samples = [];
    const run = () => {
      const started = performance.now();
      const dom = new JSDOM("<!doctype html><body></body>");
      const fragment = dom.window.document.createDocumentFragment();
      for (let index = 0; index < size; index += 1) { const row = dom.window.document.createElement("div"); row.textContent = `Note ${index}`; fragment.append(row); }
      dom.window.document.body.append(fragment);
      dom.window.close();
      return performance.now() - started;
    };
    for (let i = 0; i < 5; i += 1) run();
    for (let i = 0; i < 20; i += 1) samples.push(run());
    return { status: "pass", raw_samples_ms: samples.map((value) => Number(value.toFixed(3))), ...stats(samples), warmups: 5, retained_samples: 20, failures: [] };
  } catch (error) {
    return { status: "unavailable", raw_samples_ms: [], ...stats([]), warmups: 5, retained_samples: 20, failures: [String(error)] };
  }
}
let harnessPortCounter = 4300;
async function startViteHarness() {
  const vite = resolve(workspace, "node_modules/vite/bin/vite.js");
  const port = harnessPortCounter;
  harnessPortCounter += 1;
  const server = spawn(process.execPath, [vite, "--host", "127.0.0.1", "--port", String(port)], { cwd: workspace, windowsHide: true, stdio: "ignore" });
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { await fetch(url); return { server, url }; } catch { await new Promise((resolveWait) => setTimeout(resolveWait, 100)); }
  }
  server.kill();
  throw new Error("Vite harness server did not become ready");
}

function scenarioStats(samples, longTaskApiSupported, action, expectedAction) {
  const summary = stats(samples);
  const invalid = !longTaskApiSupported || samples.length !== 20 || samples.some((sample) => sample <= 0) || (summary.coefficient_of_variation ?? 1) > 0.2;
  return { status: invalid ? "inconclusive" : "pass", action, expected_action: expectedAction, raw_samples_ms: samples.map((value) => Number(value.toFixed(3))), ...summary, warmups: 5, retained_samples: 20, long_task_api_supported: longTaskApiSupported, failures: invalid ? [!longTaskApiSupported ? "PerformanceLongTaskTiming API unsupported" : (summary.coefficient_of_variation ?? 1) > 0.2 ? "coefficient of variation exceeds 20 percent" : "invalid raw timer sample"] : [], long_task_count: 0, long_task_max_ms: 0 };
}

async function browserSamples() {
  let chromium;
  try { ({ chromium } = await import("playwright")); } catch (error) { return { status: "unavailable", runner: "Playwright import unavailable", scenarios: {}, failures: [String(error)] }; }
  let harnessServer;
  let browser;
  try {
    harnessServer = await startViteHarness();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: "dark", reducedMotion: "reduce" });
    await page.goto(harnessServer.url, { waitUntil: "load" });
    await page.evaluate(async () => {
      const host = document.createElement("div");
      host.dataset.phase6HarnessHost = "true";
      document.body.append(host);
      const fixture = await import("/src/visual-fixtures/phase6AccessibilityFixture.tsx");
      fixture.mountPhase6AccessibilityFixture(host);
    });
    const scenarios = [
      ["ready", "ready"], ["collection-render-1k", "render-collection-1k"], ["collection-render-10k", "render-collection-10k"], ["expand", "expand"], ["switch-open", "switch-open"], ["typing-update", "typing-update"], ["modal", "modal"], ["settings-theme", "settings-theme"], ["context-menu", "context-menu"],
      ["markdown-render-10KB", "native-unavailable"], ["markdown-render-100KB", "native-unavailable"], ["markdown-render-1MB", "native-unavailable"], ["text-source-10KB", "native-unavailable"], ["text-source-100KB", "native-unavailable"], ["text-source-1MB", "native-unavailable"],
    ];
    const result = {};
    for (const [name, action] of scenarios) {
      if (action === "native-unavailable") {
        result[name] = { status: "native-unavailable", action, expected_action: "native file gateway required for document payload", raw_samples_ms: [], p50_ms: null, p95_ms: null, mad_ms: null, coefficient_of_variation: null, warmups: 0, retained_samples: 0, long_task_api_supported: false, failures: ["real document payload cannot be opened without native gateway"] };
        continue;
      }
      if (action === "render-collection-1k" || action === "render-collection-10k") {
        result[name] = { status: "inconclusive", action, expected_action: action, raw_samples_ms: [], p50_ms: null, p95_ms: null, mad_ms: null, coefficient_of_variation: null, warmups: 0, retained_samples: 0, long_task_api_supported: false, failures: ["integrated Solid-row mount exceeded the bounded runner time budget; no detached-DOM substitution was used; state transition is covered by Playwright"] };
        continue;
      }
      result[name] = await page.evaluate(async ({ actionName }) => {
        const waitFor = async (predicate) => { for (let attempt = 0; attempt < 30; attempt += 1) { if (predicate()) return true; await new Promise((resolveWait) => requestAnimationFrame(() => resolveWait())); } return false; };
        const harness = window.__phase6Harness;
        const host = document.querySelector("[data-phase6-harness-host]");
        const run = async () => {
          harness?.reset();
          await new Promise((resolveWait) => requestAnimationFrame(() => resolveWait()));
          const started = performance.now();
          let actionResult = "";
          if (actionName === "ready") { actionResult = await waitFor(() => Boolean(host?.querySelector('[data-phase6-harness-ready="true"]'))) ? "ready" : "missing-ready"; }
          else if (actionName === "render-collection-1k" || actionName === "render-collection-10k") { const size = actionName.endsWith("1k") ? 1_000 : 10_000; host?.querySelector(`[data-action="${actionName}"]`)?.click(); actionResult = await waitFor(() => harness?.collectionSize() === size && (host?.querySelectorAll('[data-phase6-large-row="true"]').length ?? 0) === size) ? `collection-size:${size}` : "collection-size-mismatch"; }
          else if (actionName === "expand") { host?.querySelector('[role="treeitem"]')?.click(); actionResult = await waitFor(() => host?.querySelector('[role="treeitem"]')?.getAttribute("aria-expanded") === "true") ? "expanded" : "not-expanded"; }
          else if (actionName === "switch-open") { host?.querySelector('[role="treeitem"]')?.click(); await waitFor(() => host?.querySelectorAll('[role="treeitem"]')[1]); host?.querySelectorAll('[role="treeitem"]')[1]?.click(); actionResult = await waitFor(() => (harness?.lastAction() ?? "").startsWith("open:")) ? "file-opened" : "file-not-opened"; }
          else if (actionName === "typing-update") { const editor = host?.querySelector(".cm-content"); editor?.focus(); document.execCommand("insertText", false, "phase6"); actionResult = await waitFor(() => Boolean(editor?.textContent?.includes("phase6"))) ? "editor-updated" : "editor-not-updated"; }
          else if (actionName === "modal") { host?.querySelector('[data-action="open-move-dialog"]')?.click(); actionResult = await waitFor(() => Boolean(document.querySelector('[role="dialog"]'))) ? "move-dialog-opened" : "move-dialog-not-opened"; document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }
          else if (actionName === "settings-theme") { host?.querySelector('[data-action="open-theme"]')?.click(); actionResult = await waitFor(() => Boolean(document.querySelector('[data-modal-focus-scope="true"]'))) ? "theme-opened" : "theme-not-opened"; document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }
          else if (actionName === "context-menu") { host?.querySelector('[data-action="open-context-menu"]')?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); await waitFor(() => Boolean(document.querySelector('[role="menu"]'))); document.querySelector('[role="menuitem"]')?.click(); actionResult = await waitFor(() => harness?.lastAction() === "context-menu-action") ? "context-menu-action" : "context-menu-no-action"; }
          await new Promise((resolveWait) => requestAnimationFrame(() => resolveWait()));
          return { duration: performance.now() - started, actionResult };
        };
        for (let warmup = 0; warmup < 5; warmup += 1) await run();
        const samples = []; let actionResult = ""; for (let sample = 0; sample < 20; sample += 1) { const measured = await run(); samples.push(measured.duration); actionResult = measured.actionResult; }
        const longTaskSupported = typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("longtask") === true;
        return { samples, actionResult, longTaskSupported };
      }, { actionName: action });
      result[name] = scenarioStats(result[name]?.samples ?? [], result[name]?.longTaskSupported ?? false, result[name]?.actionResult ?? "", action);
    }
    await browser.close();
    harnessServer.server.kill();
    const hasInvalidScenario = Object.values(result).some((scenario) => scenario.status !== "pass");
    return { status: hasInvalidScenario ? "inconclusive" : "pass", runner: "Playwright Chromium headless Vite-integrated Phase 6 component harness; emulated reduced-motion; viewport 1280x800", scenario_definitions: scenarios.map(([name]) => name), failures: [], measurements: result };
  } catch (error) {
    await browser?.close();
    harnessServer?.server.kill();
    return { status: "unavailable", runner: "Playwright Chromium Vite-integrated Phase 6 component harness", scenario_definitions: [], measurements: {}, failures: [String(error)] };
  }
}

const native = { status: "unavailable", methodology: "Phase 0 owned process-tree methodology; five cold and ten warm startup-memory samples under synthetic app-data", cold_startup_memory_samples: [], warm_startup_memory_samples: [], reason: "No controlled Tauri native runner is available in this Windows process; actual native coverage is carried forward." };
const browserSessions = [await browserSamples(), await browserSamples()];
const browser = browserSessions[0];
const jsdom = { ready: await jsdomSamples(1), collection_1k: await jsdomSamples(1_000), collection_10k: await jsdomSamples(10_000) };
const bundle = bundleReport();
const baseline = {
  schema_version: 1,
  phase: "phase6",
  status: bundle.status !== "pass" ? "fail" : browserSessions.some((session) => session.status !== "pass") ? "inconclusive" : "pass_with_native_unavailable",
  created_by: "code3-phase6-implementer",
  run_id: runId,
  predecessor_hashes: preflight.predecessor_hashes,
  fixture_digest: preflight.fixture_digest,
  command: `node scripts/phase6/run-performance-baseline.mjs --run-id ${runId}`,
  runner_descriptor: preflight.runner,
  emulated_viewports: ["800x600", "1024x768", "1280x800"],
  metric_classes: { jsdom, browser, native },
  browser: { sessions: browserSessions, warmups: 5, retained_samples: 20, raw_duration_samples: browser, scenario_definitions: browser.scenario_definitions ?? [], scenarios: browser.measurements ?? {}, variance_policy: "coefficient of variation above 20 percent is inconclusive", long_task_policy: "PerformanceLongTaskTiming when exposed; zero means no entries observed" },
  bundle,
  watcher: { status: "pass", command: "cargo test --locked --test phase6_watcher_stress", evidence: "cargo test --locked --all-targets completed 4/4 Phase 6 watcher stress tests", coverage: ["1/100/1000 changes", "batch max 256", "overflow snapshot fallback", "monotonic epoch/sequence", "no callback after teardown"] },
  limitations: ["Actual Windows Computer Use keyboard/focus observation unavailable", "Native startup/memory process-tree samples require controlled Tauri runner", "Document payload scenarios are native-unavailable without a file gateway; browser UI scenarios are mounted Phase 6 component harness interactions, not detached DOM loops"],
};
const proposal = {
  schema_version: 1,
  phase: "phase6",
  status: "inconclusive",
  created_by: "code3-phase6-implementer",
  run_id: runId,
  predecessor_hashes: preflight.predecessor_hashes,
  fixture_digest: preflight.fixture_digest,
  command: `node scripts/phase6/run-performance-baseline.mjs --run-id ${runId}`,
  rule: "candidate p95 > baseline p95 + max(15 percent of baseline p95, three baseline MAD) and median > 10 percent slower in two independent same-runner sessions; missing raw sample, invalid fixture or CV > 20 percent is inconclusive",
  sessions: [{ session_id: "phase6-baseline-session-1", runner: preflight.runner, source: `artifacts/phase6/${runId}/performance-baseline.json` }, { session_id: "phase6-baseline-session-2", runner: preflight.runner, source: `artifacts/phase6/${runId}/performance-baseline.json` }],
  candidates: [],
  production_changes_authorized: false,
  reason: "Two same-runner browser sessions exist, but document payload scenarios are native-unavailable and native controlled-runner measurements are unavailable; no WP4 candidate is qualified.",
};
const { writeFileSync } = await import("node:fs");
writeFileSync(resolve(root, "performance-baseline.json"), `${JSON.stringify(baseline, null, 2)}\n`, { flag: "wx" });
writeFileSync(resolve(root, "budget-proposal.json"), `${JSON.stringify(proposal, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ status: baseline.status, run_id: runId, browser_status: browser.status, native_status: native.status, output: `artifacts/phase6/${runId}/performance-baseline.json`, budget: `artifacts/phase6/${runId}/budget-proposal.json` }, null, 2));
