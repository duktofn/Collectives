#!/usr/bin/env node
/* global console, process */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const workspace = resolve(import.meta.dirname, "../..");
const phaseRoot = resolve(workspace, "artifacts/phase6");
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const createdBy = "code3-phase6-implementer";

function fail(message) { throw new Error(message); }
function parseRunArgs() {
const index = process.argv.indexOf("--run-id");
const runId = index >= 0 ? process.argv[index + 1] : "";
if (!runId || !SAFE_RUN_ID.test(runId) || runId.includes("..")) fail("a safe --run-id is required");
const beforeIndex = process.argv.indexOf("--before-run-id");
const beforeRunId = beforeIndex >= 0 ? process.argv[beforeIndex + 1] : "";
if (beforeRunId && (!SAFE_RUN_ID.test(beforeRunId) || beforeRunId.includes(".."))) fail("unsafe --before-run-id");
  return { runId, beforeRunId };
}
function inside(path, root) {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith("../") && !rel.startsWith("..\\"));
}
function hash(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function commandText(command, args) {
  const result = spawnSync(command, args, { cwd: workspace, encoding: "utf8", windowsHide: true });
  return { command: [command, ...args].join(" "), status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}
function repositoryFiles() {
  const result = spawnSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: workspace, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).filter(Boolean).map((path) => resolve(workspace, path)).filter((path) => existsSync(path) && lstatSync(path).isFile()).map((path) => ({ path: relative(workspace, path).replaceAll("\\", "/"), sha256: hash(path), size: lstatSync(path).size })).sort((a, b) => a.path.localeCompare(b.path));
}
function json(path) { return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")); }

const { runId, beforeRunId } = parseRunArgs();
const runRoot = resolve(phaseRoot, runId);
if (!inside(runRoot, phaseRoot) || existsSync(runRoot)) fail(`Phase 6 run root must be a new directory: artifacts/phase6/${runId}`);
mkdirSync(runRoot, { recursive: true });
const beforeAnchorPath = beforeRunId ? resolve(phaseRoot, beforeRunId, "preflight.json") : null;
const beforeAnchor = beforeAnchorPath && existsSync(beforeAnchorPath) ? json(beforeAnchorPath) : null;
if (beforeRunId && !beforeAnchor) fail(`before-run anchor is missing: ${beforeRunId}`);

const packageJson = json(resolve(workspace, "package.json"));
const packageLock = json(resolve(workspace, "package-lock.json"));
const pinnedTauriCli = packageLock.packages?.["node_modules/@tauri-apps/cli"]?.version ?? "unresolved";
const lockPaths = ["package-lock.json", "src-tauri/Cargo.lock"];
const predecessorPaths = [
  "artifacts/phase3/approved-manifest.json",
  "artifacts/phase4/approved-manifest.json",
  "artifacts/phase4/hotfix41/approved-manifest.json",
  "artifacts/feature42/approved-manifest.json",
  "artifacts/phase5/phase5-20260824-feature42-final/baseline-source.json",
  "artifacts/phase5/phase5-20260824-feature42-final/preflight.json",
  "artifacts/phase5/phase5-20260824-feature42-final/reconciliation.json",
  "artifacts/phase5/phase5-20260824-feature42-final/visual-before-manifest.json",
  "artifacts/phase5/phase5-20260824-feature42-final/visual-after-manifest.json",
  "artifacts/phase5/phase5-20260824-feature42-final/visual-review.json",
];
const predecessors = predecessorPaths.map((relativePath) => {
  const path = resolve(workspace, relativePath);
  if (!existsSync(path) || !lstatSync(path).isFile()) fail(`missing approved predecessor: ${relativePath}`);
  return { path: relativePath, sha256: hash(path) };
});
const fixtureDescriptor = "phase6-accessibility-fixture.v1|tree|group|treeitem|menu|menuitem|separator|keyboard|pointer|focus|forced-colors|reduced-motion";
const rustc = commandText("rustc", ["--version"]);
const cargo = commandText("cargo", ["--version"]);
const status = commandText("git", ["status", "--short"]);
const preflight = {
  schema_version: 1,
  phase: "phase6",
  status: "pass",
  created_by: createdBy,
  run_id: runId,
  captured_at: new Date().toISOString(),
  runner: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    rustc: rustc.output,
    cargo: cargo.output,
    tauri_cli: pinnedTauriCli,
    tauri_cli_declared: packageJson.devDependencies?.["@tauri-apps/cli"] ?? "not declared",
    playwright: packageJson.devDependencies?.["@playwright/test"] ?? "not declared",
    windows_cpu: process.env.PROCESSOR_IDENTIFIER ?? "unavailable in controlled process",
    windows_ram: "unavailable in controlled process",
    display_scale: "unavailable; actual OS coverage carried to Phase 7 unless preconfigured runner supplies it",
  },
  lock_hashes: lockPaths.map((relativePath) => ({ path: relativePath, sha256: hash(resolve(workspace, relativePath)) })),
  predecessor_hashes: predecessors,
  fixture_digest: createHash("sha256").update(fixtureDescriptor).digest("hex"),
  fixture: { descriptor: fixtureDescriptor, source_state: "adopted_existing_code3_state_unverifiable_before_this_revision" },
  preflight_scope: "revision-only; existing Code 3 implementation/artifact state is adopted and not attributed by this reconciliation",
  git_status_before: beforeAnchor?.git_status_before ?? status.output,
  repository_inventory_before: beforeAnchor?.repository_inventory_before ?? repositoryFiles(),
  before_anchor: beforeAnchor ? { run_id: beforeRunId, preflight: `artifacts/phase6/${beforeRunId}/preflight.json`, scope: "immutable revision preflight captured before bounded changes" } : { run_id: null, scope: "new baseline capture" },
  command: "node scripts/phase6/capture-preflight.mjs --run-id " + runId + (beforeRunId ? ` --before-run-id ${beforeRunId}` : ""),
  tool_versions: { node: process.version, rustc: rustc.output, cargo: cargo.output },
  coverage: { emulated: ["role-name", "keyboard", "pointer-parity", "focus-cleanup", "800x600", "1024x768", "1280x800", "200% text zoom", "forced-colors", "reduced-motion"], actual_os: "unavailable" },
};
writeFileSync(resolve(runRoot, "preflight.json"), `${JSON.stringify(preflight, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ status: preflight.status, phase: preflight.phase, run_id: runId, output: `artifacts/phase6/${runId}/preflight.json` }, null, 2));
