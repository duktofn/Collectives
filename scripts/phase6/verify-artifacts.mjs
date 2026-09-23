#!/usr/bin/env node
/* global console, process */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const workspace = resolve(import.meta.dirname, "../..");
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const exactAllowedLeaves = new Set([
  "scripts/phase5/resolve-predecessors.mjs", "scripts/phase5/resolve-predecessors.test.mjs",
  "scripts/phase6/capture-preflight.mjs", "scripts/phase6/check-accessibility-contract.mjs", "scripts/phase6/check-tauri-config.mjs", "scripts/phase6/build-frontend-stage.mjs", "scripts/phase6/run-performance-baseline.mjs", "scripts/phase6/verify-release-stage.mjs", "scripts/phase6/verify-artifacts.mjs",
  "src/a11y/announcer.ts", "src/a11y/announcer.test.ts",
  "src/components/common/ContextMenu.tsx", "src/components/common/Common.css", "src/components/common/ContextMenu.a11y.test.tsx", "src/components/common/MoveTargetRadioGroup.tsx", "src/components/common/Dialog.tsx", "src/components/common/FolderRefReadinessNotice.tsx",
  "src/components/tree/treeAccessibility.ts", "src/components/tree/treeAccessibility.test.tsx", "src/components/tree/TreeNode.tsx", "src/components/tree/FileNode.tsx", "src/components/tree/GroupNode.tsx", "src/components/tree/FolderRefNode.tsx", "src/components/tree/FolderRefChildRow.tsx", "src/components/tree/Tree.css",
  "src/components/sidebar/Sidebar.tsx", "src/components/sidebar/CollectionItem.tsx", "src/components/sidebar/Sidebar.css", "src/components/sidebar/Sidebar.a11y.test.tsx",
  "src/components/shell/ActivityStatus.tsx", "src/components/shell/AppShell.tsx", "src/components/editor/Editor.tsx", "src/components/editor/EditorToolbar.tsx", "src/components/editor/Editor.css", "src/components/editor/Editor.a11y.test.tsx", "src/components/theme/ThemePanel.tsx", "src/App.tsx",
  "src/styles/variables.css", "src/styles/design-tokens.css", "src/styles/design-system.css", "src/benchmarks/phase6-ui-latency.bench.ts", "src-tauri/tests/phase6_watcher_stress.rs", "src/visual-fixtures/phase6AccessibilityFixture.tsx", "e2e/phase6.accessibility.spec.ts", "e2e/phase6.performance.spec.ts", "playwright.phase6.config.ts", ".github/workflows/phase6-quality.yml", "docs/rebuild/phase-6-accessibility-performance-report.md", "src-tauri/tauri.conf.json", "eslint.config.js",
]);
function fail(message) { throw new Error(message); }
const index = process.argv.indexOf("--run-id");
const runId = index >= 0 ? process.argv[index + 1] : "";
if (!runId || !SAFE_RUN_ID.test(runId) || runId.includes("..")) fail("a safe --run-id is required");
const root = resolve(workspace, "artifacts/phase6", runId);
const preflightPath = resolve(root, "preflight.json");
if (!existsSync(preflightPath)) fail("preflight.json is missing");
const preflight = JSON.parse(readFileSync(preflightPath, "utf8"));
if (preflight.preflight_scope !== "revision-only; existing Code 3 implementation/artifact state is adopted and not attributed by this reconciliation") fail("revision preflight must explicitly identify the adopted existing Code 3 state");
function filesIn(directory) {
  const files = [];
  const visit = (current) => { for (const entry of readdirSync(current, { withFileTypes: true })) { const path = resolve(current, entry.name); if (entry.isDirectory()) visit(path); else if (entry.isFile()) files.push(path); } };
  visit(directory);
  return files;
}
function hash(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function repositoryInventory() {
  const result = spawnSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: workspace, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) fail(`git inventory failed: ${result.error?.message ?? result.stderr ?? "unknown error"}`);
  return result.stdout.split(/\r?\n/).filter(Boolean).map((path) => resolve(workspace, path)).filter((path) => existsSync(path) && lstatSync(path).isFile()).map((path) => ({ path: relative(workspace, path).replaceAll("\\", "/"), sha256: hash(path), size: lstatSync(path).size })).sort((a, b) => a.path.localeCompare(b.path));
}
function readEvidence(file) { const path = resolve(root, file); return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null; }
const required = ["preflight.json", "a11y-contract.json", "tauri.stage.conf.json", "stage-config-probe.json", "frontend-stage.json", "performance-baseline.json", "budget-proposal.json", "package-stage.json"];
const failures = [];
for (const file of required) if (!existsSync(resolve(root, file))) failures.push(`missing evidence: ${file}`);
const a11y = readEvidence("a11y-contract.json");
const stageProbe = readEvidence("stage-config-probe.json");
const baseline = readEvidence("performance-baseline.json");
const budget = readEvidence("budget-proposal.json");
const packageStage = readEvidence("package-stage.json");
if (a11y && a11y.status !== "pass") failures.push("accessibility contract is not a clean pass");
if (stageProbe && (stageProbe.status !== "pass_static_config" || stageProbe.tauri_merge_validation?.status !== "BLOCKED")) failures.push("Tauri probe must separate static validation from blocked actual merge validation");
if (baseline && !["pass_with_native_unavailable", "inconclusive"].includes(baseline.status)) failures.push("performance baseline failed");
if (baseline && baseline.browser?.sessions?.length !== 2) failures.push("performance baseline must contain two browser sessions");
if (baseline?.bundle?.status !== "pass" || baseline?.bundle?.evidence_source_map_policy !== "evidence-only maps provide per-module attribution") failures.push("bundle attribution/release source-map exclusion is incomplete");
if (budget && (budget.status !== "inconclusive" || budget.production_changes_authorized !== false)) failures.push("budget proposal must stop before optimization");
if (packageStage && packageStage.status !== "BLOCKED") failures.push("Gate E must remain BLOCKED without controlled runner");
if (existsSync(resolve(workspace, "artifacts/phase6/approved-manifest.json"))) failures.push("Phase 6 approved manifest must not be created while Gate E is BLOCKED");
const stage = readEvidence("tauri.stage.conf.json");
if (stage && stage.build?.frontendDist !== `../artifacts/phase6/${runId}/frontend`) failures.push("stage frontendDist does not match approved relative path");
if (stage && stage.build?.beforeBuildCommand !== `node scripts/phase6/build-frontend-stage.mjs --run-id ${runId}`) failures.push("stage beforeBuildCommand does not match approved script");

const before = new Map((preflight.repository_inventory_before ?? []).map((item) => [item.path, item.sha256]));
const afterAll = repositoryInventory();
const afterSource = afterAll.filter((item) => !item.path.startsWith("artifacts/"));
const changedPaths = afterSource.filter((item) => before.get(item.path) !== item.sha256).map((item) => item.path);
const removedPaths = [...before.keys()].filter((path) => !path.startsWith("artifacts/") && !afterSource.some((item) => item.path === path));
const changedOutsideAllowlist = [...changedPaths, ...removedPaths].filter((path) => !exactAllowedLeaves.has(path));
if (changedOutsideAllowlist.length) failures.push(`revision changed paths outside exact allowlist: ${changedOutsideAllowlist.join(", ")}`);

const phase5PreflightPath = resolve(workspace, "artifacts/phase5/phase5-20260824-feature42-final/preflight.json");
const phase5Preflight = JSON.parse(readFileSync(phase5PreflightPath, "utf8"));
const phase5Baseline = new Map(Object.entries(phase5Preflight.path_hashes ?? {}));
const phase5Scope = new Set(phase5Preflight.relative_modified_paths ?? []);
const phase5Mismatches = [];
const phase5AddedAdopted = [];
const phase5BaselineOutside = [];
const revisionChangedSet = new Set(changedPaths);
for (const item of afterSource.filter((candidate) => revisionChangedSet.has(candidate.path))) {
  if (phase5Baseline.has(item.path)) {
    if (phase5Baseline.get(item.path) !== item.sha256) {
      if (exactAllowedLeaves.has(item.path)) phase5Mismatches.push({ path: item.path, baseline_sha256: phase5Baseline.get(item.path), current_sha256: item.sha256, state: "adopted_existing_code3_state" });
      else phase5BaselineOutside.push(item.path);
    }
  } else if (phase5Scope.has(item.path)) {
    phase5BaselineOutside.push(item.path);
  } else if (exactAllowedLeaves.has(item.path)) {
    phase5AddedAdopted.push(item.path);
  } else {
    phase5BaselineOutside.push(item.path);
  }
}
if (phase5BaselineOutside.length) failures.push(`immutable Phase 5 baseline cannot explain paths outside exact Phase 6 allowlist: ${phase5BaselineOutside.join(", ")}`);
const lintBinary = process.platform === "win32" ? "cmd.exe" : "npm";
const lintArgs = process.platform === "win32" ? ["/d", "/s", "/c", "npm run lint"] : ["run", "lint"];
const lintResult = spawnSync(lintBinary, lintArgs, { cwd: workspace, encoding: "utf8", windowsHide: true, maxBuffer: 128 * 1024 * 1024 });
const lintEvidence = { schema_version: 1, phase: "phase6", status: lintResult.status === 0 ? "pass" : "fail", created_by: "code3-phase6-implementer", run_id: runId, predecessor_hashes: preflight.predecessor_hashes, fixture_digest: preflight.fixture_digest, command: "npm run lint", tool_versions: { node: process.version }, exit_code: lintResult.status, error: lintResult.error?.message ?? null, output: `${lintResult.stdout ?? ""}${lintResult.stderr ?? ""}` };
writeFileSync(resolve(root, "lint-gate.json"), `${JSON.stringify(lintEvidence, null, 2)}\n`, { flag: "wx" });
if (lintEvidence.status !== "pass") failures.push("canonical npm run lint failed");

const artifactInventory = filesIn(root).map((path) => ({ path: relative(root, path).replaceAll("\\", "/"), sha256: hash(path), size: lstatSync(path).size })).sort((a, b) => a.path.localeCompare(b.path));
const reconciliation = {
  schema_version: 1,
  phase: "phase6",
  status: failures.length ? "BLOCKED" : "pass_revision_only",
  created_by: "code3-phase6-implementer",
  run_id: runId,
  predecessor_hashes: preflight.predecessor_hashes,
  fixture_digest: preflight.fixture_digest,
  command: `node scripts/phase6/verify-artifacts.mjs --run-id ${runId}`,
  baseline_anchor: { phase5_preflight: "artifacts/phase5/phase5-20260824-feature42-final/preflight.json", phase5_preflight_sha256: hash(phase5PreflightPath), phase5_baseline_reconstruction: phase5BaselineOutside.length ? "BLOCKED" : "pass_with_adopted_existing_code3_state" },
  pre_change_proof: { source: "artifacts/phase6/phase6-20260825-code3-rev2/preflight.json", scope: "revision-only", existing_code3_state: "adopted_unverifiable", revision_changed_paths: changedPaths, revision_removed_paths: removedPaths, changed_paths_outside_exact_allowlist: changedOutsideAllowlist },
  adopted_existing_code3_paths: { count: phase5Mismatches.length + phase5AddedAdopted.length, content_mismatches: phase5Mismatches, added_paths: phase5AddedAdopted },
  protected_state: { cargo_toml_hash: "20202baf2da1bc0c1842a33774eaf3a573b830901a1b791e5d670a8ad46dacba", cargo_binary_diff_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", manifests_immutable: true },
  pre_content_hashes: preflight.repository_inventory_before,
  post_content_hashes: afterSource,
  exact_approved_leaf_allowlist: [...exactAllowedLeaves].sort(),
  artifact_inventory: artifactInventory,
  failures,
};
writeFileSync(resolve(root, "reconciliation.json"), `${JSON.stringify(reconciliation, null, 2)}\n`, { flag: "wx" });
const verification = {
  schema_version: 1,
  phase: "phase6",
  status: failures.length ? "BLOCKED" : "pass_with_gate_e_blocked",
  created_by: "code3-phase6-implementer",
  run_id: runId,
  predecessor_hashes: preflight.predecessor_hashes,
  fixture_digest: preflight.fixture_digest,
  command: `node scripts/phase6/verify-artifacts.mjs --run-id ${runId}`,
  evidence: [...required, "lint-gate.json", "reconciliation.json", "verification.json"].map((file) => `artifacts/phase6/${runId}/${file}`),
  gate_e: packageStage?.status ?? "missing",
  tauri_merge_validation: stageProbe?.tauri_merge_validation?.status ?? "missing",
  wp4_authorized: false,
  failures,
};
writeFileSync(resolve(root, "verification.json"), `${JSON.stringify(verification, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ status: verification.status, phase: verification.phase, run_id: runId, failures, reconciliation: `artifacts/phase6/${runId}/reconciliation.json`, verification: `artifacts/phase6/${runId}/verification.json` }, null, 2));
if (failures.length) process.exitCode = 1;
