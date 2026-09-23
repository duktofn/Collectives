#!/usr/bin/env node
/* global console, process, structuredClone */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const expectedCsp = {
  "default-src": "'self' customprotocol: asset:",
  "connect-src": "ipc: http://ipc.localhost",
  "img-src": "'self' asset: http://asset.localhost blob: data:",
  "style-src": "'self' 'unsafe-inline'",
  "font-src": "'self' asset: http://asset.localhost data:",
  "script-src": "'self'",
};
function fail(message) { throw new Error(message); }
function runId() { const index = process.argv.indexOf("--run-id"); const value = index >= 0 ? process.argv[index + 1] : ""; if (!value || !SAFE_RUN_ID.test(value) || value.includes("..")) fail("a safe --run-id is required"); return value; }
function readJson(path) { return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")); }
function inside(path, root) { const rel = relative(root, path); return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith("../") && !rel.startsWith("..\\")); }
function hash(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
const id = runId();
const root = resolve(workspace, "artifacts/phase6", id);
const preflight = resolve(root, "preflight.json");
if (!existsSync(preflight)) fail("preflight.json must be captured before Tauri config check");
const baseConfigPath = resolve(workspace, "src-tauri/tauri.conf.json");
const baseConfigDir = resolve(workspace, "src-tauri");
const base = readJson(baseConfigPath);
const failures = [];
if (base.productName !== "Collectives") failures.push("productName must be Collectives");
if (base.identifier !== "com.collection.note") failures.push("identifier changed");
if (base.version !== "0.1.0") failures.push("version changed");
if (base.app?.windows?.[0]?.title !== "Collectives") failures.push("Windows title must be Collectives");
if (JSON.stringify(base.app?.security?.csp) !== JSON.stringify(expectedCsp)) failures.push("CSP does not match the exact approved object");
const relativeFrontendDist = `../artifacts/phase6/${id}/frontend`;
const buildScript = resolve(workspace, "scripts/phase6/build-frontend-stage.mjs");
const stage = structuredClone(base);
stage.build = { ...base.build, beforeBuildCommand: `node scripts/phase6/build-frontend-stage.mjs --run-id ${id}`, frontendDist: relativeFrontendDist };
const stagePath = resolve(root, "tauri.stage.conf.json");
const resolvedFrontendDist = resolve(baseConfigDir, relativeFrontendDist);
const probe = {
  schema_version: 1,
  phase: "phase6",
  status: failures.length ? "fail" : "pass_static_config",
  created_by: "code3-phase6-implementer",
  run_id: id,
  predecessor_hashes: readJson(preflight).predecessor_hashes,
  fixture_digest: readJson(preflight).fixture_digest,
  command: `node scripts/phase6/check-tauri-config.mjs --run-id ${id}`,
  merge_inputs: { base_config: "src-tauri/tauri.conf.json", stage_overrides: ["build.beforeBuildCommand", "build.frontendDist"], csp: expectedCsp },
  base_config_dir: "src-tauri",
  base_config_sha256: hash(baseConfigPath),
  stage_config_path: `artifacts/phase6/${id}/tauri.stage.conf.json`,
  stage_config_sha256: hash(baseConfigPath),
  resolved_frontend_dist: relative(workspace, resolvedFrontendDist).replaceAll("\\", "/"),
  resolved_script: relative(workspace, buildScript).replaceAll("\\", "/"),
  containment: { frontend_dist_inside_run_root: inside(resolvedFrontendDist, root), script_inside_workspace: inside(buildScript, workspace), run_root_inside_workspace: inside(root, workspace) },
  tauri_merge_validation: { status: "BLOCKED", reason: "Pinned Tauri CLI/controlled runner is unavailable under Windows Application Control; static JSON merge inputs are recorded without claiming an actual Tauri merge pass." },
  failures,
};
if (failures.length) {
  writeFileSync(resolve(root, "stage-config-probe.json"), `${JSON.stringify(probe, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify(probe, null, 2));
  process.exitCode = 1;
} else {
  writeFileSync(stagePath, `${JSON.stringify(stage, null, 2)}\n`, { flag: "wx" });
  probe.stage_config_sha256 = hash(stagePath);
  writeFileSync(resolve(root, "stage-config-probe.json"), `${JSON.stringify(probe, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ ...probe, output: `artifacts/phase6/${id}/stage-config-probe.json` }, null, 2));
}
