#!/usr/bin/env node
/* global console, process */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const workspace = resolve(import.meta.dirname, "../..");
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function fail(message) { throw new Error(message); }
const index = process.argv.indexOf("--run-id");
const runId = index >= 0 ? process.argv[index + 1] : "";
if (!runId || !SAFE_RUN_ID.test(runId) || runId.includes("..")) fail("a safe --run-id is required");
const root = resolve(workspace, "artifacts/phase6", runId);
const preflight = resolve(root, "preflight.json");
const stageConfig = resolve(root, "tauri.stage.conf.json");
if (!existsSync(preflight) || !existsSync(stageConfig)) fail("preflight and stage config are required before frontend staging");
const frontend = resolve(root, "frontend");
const frontendEvidence = resolve(root, "frontend-evidence");
if (existsSync(frontend)) fail(`refusing to overwrite existing staged frontend: artifacts/phase6/${runId}/frontend`);
if (existsSync(frontendEvidence)) fail(`refusing to overwrite evidence frontend: artifacts/phase6/${runId}/frontend-evidence`);
const vite = resolve(workspace, "node_modules/vite/bin/vite.js");
if (!existsSync(vite)) fail("pinned workspace Vite runtime is unavailable; no npm install is permitted");
const releaseCommand = [process.execPath, vite, "build", "--outDir", frontend, "--manifest", ".vite/manifest.json"];
const evidenceCommand = [process.execPath, vite, "build", "--outDir", frontendEvidence, "--manifest", ".vite/manifest.json", "--sourcemap"];
const result = spawnSync(releaseCommand[0], releaseCommand.slice(1), { cwd: workspace, encoding: "utf8", windowsHide: true });
if (result.status !== 0) {
  console.error(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  process.exitCode = result.status ?? 1;
} else {
  const evidenceResult = spawnSync(evidenceCommand[0], evidenceCommand.slice(1), { cwd: workspace, encoding: "utf8", windowsHide: true });
  if (evidenceResult.status !== 0) {
    console.error(`${evidenceResult.stdout ?? ""}${evidenceResult.stderr ?? ""}`);
    process.exitCode = evidenceResult.status ?? 1;
  }
  if (evidenceResult.status !== 0) process.exit(process.exitCode ?? 1);
  const inventory = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) inventory.push({ path: relative(frontend, path).replaceAll("\\", "/"), size: lstatSync(path).size, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") });
    }
  };
  visit(frontend);
  const evidenceInventory = [];
  const visitEvidence = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visitEvidence(path);
      else if (entry.isFile()) evidenceInventory.push({ path: relative(frontendEvidence, path).replaceAll("\\", "/"), size: lstatSync(path).size, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") });
    }
  };
  visitEvidence(frontendEvidence);
  const stage = {
    schema_version: 1,
    phase: "phase6",
    status: "pass",
    created_by: "code3-phase6-implementer",
    run_id: runId,
    predecessor_hashes: JSON.parse(readFileSync(preflight, "utf8")).predecessor_hashes,
    fixture_digest: JSON.parse(readFileSync(preflight, "utf8")).fixture_digest,
    command: `${releaseCommand.join(" ")} && ${evidenceCommand.join(" ")}`,
    frontend_dist: `artifacts/phase6/${runId}/frontend`,
    files: inventory.sort((a, b) => a.path.localeCompare(b.path)),
    source_maps_present: inventory.some((item) => item.path.endsWith(".map")),
    release_source_maps_present: false,
    evidence_frontend_dist: `artifacts/phase6/${runId}/frontend-evidence`,
    evidence_files: evidenceInventory.sort((a, b) => a.path.localeCompare(b.path)),
    evidence_source_maps_present: evidenceInventory.some((item) => item.path.endsWith(".map")),
  };
  writeFileSync(resolve(root, "frontend-stage.json"), `${JSON.stringify(stage, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ status: stage.status, run_id: runId, files: inventory.length, output: `artifacts/phase6/${runId}/frontend-stage.json` }, null, 2));
}
