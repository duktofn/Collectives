#!/usr/bin/env node
/* global console, process */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const workspace = resolve(import.meta.dirname, "../..");
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function fail(message) { throw new Error(message); }
const index = process.argv.indexOf("--run-id");
const runId = index >= 0 ? process.argv[index + 1] : "";
if (!runId || !SAFE_RUN_ID.test(runId) || runId.includes("..")) fail("a safe --run-id is required");
const root = resolve(workspace, "artifacts/phase6", runId);
const preflightPath = resolve(root, "preflight.json");
const stageConfig = resolve(root, "tauri.stage.conf.json");
if (!existsSync(preflightPath) || !existsSync(stageConfig)) fail("preflight and stage config are required before release-stage verification");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const controlledRunner = process.env.COLLECTIVES_PHASE6_CONTROLLED_RUNNER === "1";
const version = spawnSync(npm, ["run", "tauri", "--", "--version"], { cwd: workspace, encoding: "utf8", windowsHide: true });
const help = version.status === 0 ? spawnSync(npm, ["run", "tauri", "--", "--help"], { cwd: workspace, encoding: "utf8", windowsHide: true }) : null;
const versionOutput = `${version.stdout ?? ""}${version.stderr ?? ""}`.trim();
const helpOutput = help ? `${help.stdout ?? ""}${help.stderr ?? ""}` : "";
const noSignAccepted = /--no-sign/.test(helpOutput);
const blockers = [];
let packageAttempt = null;
if (version.status !== 0) blockers.push("pinned Tauri CLI preflight failed; controlled Windows Application Control runner is required");
if (version.status === 0 && !controlledRunner) blockers.push("no approved controlled runner marker was present");
if (version.status === 0 && controlledRunner && !noSignAccepted) blockers.push("pinned CLI help did not accept --no-sign");
if (version.status === 0 && controlledRunner && noSignAccepted) {
  const target = resolve(root, "tauri-target");
  packageAttempt = spawnSync(npm, ["run", "tauri", "--", "build", "--config", `artifacts/phase6/${runId}/tauri.stage.conf.json`, "--no-sign"], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, CARGO_TARGET_DIR: target },
  });
  if (packageAttempt.status !== 0) blockers.push("controlled package stage failed");
}
const status = blockers.length ? "BLOCKED" : "pass";
const packageEvidence = {
  schema_version: 1,
  phase: "phase6",
  status,
  created_by: "code3-phase6-implementer",
  run_id: runId,
  predecessor_hashes: JSON.parse(readFileSync(preflightPath, "utf8")).predecessor_hashes,
  fixture_digest: JSON.parse(readFileSync(preflightPath, "utf8")).fixture_digest,
  command: "npm run tauri -- --version; npm run tauri -- --help; conditional staged build",
  gate: "E",
  controlled_runner: controlledRunner,
  cli_preflight: { status: version.status, output: versionOutput, no_sign_accepted: noSignAccepted, help_output: helpOutput },
  package_attempt: packageAttempt ? { status: packageAttempt.status, output: `${packageAttempt.stdout ?? ""}${packageAttempt.stderr ?? ""}`.trim(), signing_state: "unsigned", target_root: `artifacts/phase6/${runId}/tauri-target` } : null,
  members: { msi: "BLOCKED until approved inspector/stage is available", nsis: "BLOCKED until approved controlled-runner static inspector is available" },
  blockers,
  forbidden_actions_observed: ["no npm install", "no dependency or lockfile change", "no src-tauri/target write", "no installer execution against user data"],
};
writeFileSync(resolve(root, "package-stage.json"), `${JSON.stringify(packageEvidence, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ status, run_id: runId, blockers, output: `artifacts/phase6/${runId}/package-stage.json` }, null, 2));
