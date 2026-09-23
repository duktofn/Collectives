#!/usr/bin/env node
/* global console, process */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const workspace = resolve(import.meta.dirname, "../..");
const value = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const runId = value("--run-id");
if (!runId || !/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error("--run-id is required and must be safe");
const reconcilePath = value("--reconcile");
const artifactRoot = resolve(workspace, "artifacts/feature42", runId);
const output = resolve(artifactRoot, "preflight.json");
const rel = (path) => relative(workspace, path).replaceAll("\\", "/");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const fileSha = (path) => sha(readFileSync(path));
const git = (args) => execFileSync("git", args, { cwd: workspace, encoding: "buffer" });
const textGit = (args) => git(args).toString("utf8");
const commandVersion = (command, args) => {
  try { return execFileSync(command, args, { cwd: workspace, encoding: "utf8" }).trim(); }
  catch { return "unavailable"; }
};
const safePath = (path) => path && !path.startsWith("artifacts/") && !path.startsWith("test-results/");
const trackedDiff = git(["diff", "--binary", "--no-ext-diff", "HEAD", "--", "."]);
const untracked = textGit(["ls-files", "--others", "--exclude-standard", "-z"])
  .split("\0")
  .filter((path) => safePath(path) && path && existsSync(resolve(workspace, path)) && statSync(resolve(workspace, path)).isFile())
  .map((path) => ({ path: path.replaceAll("\\", "/"), sha256: fileSha(resolve(workspace, path)) }));
const untrackedFingerprint = sha(JSON.stringify(untracked));
const cargoPath = resolve(workspace, "src-tauri/Cargo.toml");
const approvedManifest = resolve(workspace, "artifacts/phase4/hotfix41/approved-manifest.json");
const result = {
  schema_version: 1,
  phase: "feature42",
  run_id: runId,
  captured_at: new Date().toISOString(),
  head: textGit(["rev-parse", "HEAD"]).trim(),
  tracked_binary_diff_sha256: sha(trackedDiff),
  untracked_inventory: untracked,
  untracked_inventory_sha256: untrackedFingerprint,
  cargo_toml: {
    content_sha256: fileSha(cargoPath),
    binary_diff_sha256: sha(git(["diff", "--binary", "--no-ext-diff", "HEAD", "--", "src-tauri/Cargo.toml"])),
  },
  hotfix41_approved_manifest_sha256: existsSync(approvedManifest) ? fileSha(approvedManifest) : "missing",
  tool_versions: {
    node: process.version,
    npm: commandVersion("npm", ["--version"]),
    rustc: commandVersion("rustc", ["--version"]),
    cargo: commandVersion("cargo", ["--version"]),
  },
  policy: "Feature 4.2 artifacts contain workspace-relative paths only; external/user filesystem paths are not read, logged, hashed or copied",
};
if (reconcilePath) {
  const baselinePath = resolve(workspace, reconcilePath);
  if (!existsSync(baselinePath)) throw new Error("reconciliation baseline is missing");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const currentByPath = new Map(result.untracked_inventory.map((entry) => [entry.path, entry.sha256]));
  const failures = [];
  if (baseline.run_id !== runId) failures.push("baseline run id mismatch");
  if (baseline.head !== result.head) failures.push("HEAD changed during Feature 4.2 run");
  if (baseline.tracked_binary_diff_sha256 !== result.tracked_binary_diff_sha256) failures.push("tracked binary diff changed during Feature 4.2 run");
  if (baseline.cargo_toml?.content_sha256 !== result.cargo_toml.content_sha256) failures.push("Cargo.toml content fingerprint changed");
  if (baseline.cargo_toml?.binary_diff_sha256 !== result.cargo_toml.binary_diff_sha256) failures.push("Cargo.toml binary diff fingerprint changed");
  for (const entry of baseline.untracked_inventory ?? []) if (currentByPath.get(entry.path) !== entry.sha256) failures.push(`initial untracked path changed: ${entry.path}`);
  const reconciliation = {
    schema_version: 1,
    phase: "feature42",
    run_id: runId,
    status: failures.length ? "fail" : "pass",
    baseline: rel(baselinePath),
    reconciled_at: new Date().toISOString(),
    protected_state_preserved: failures.length === 0,
    cargo_toml: result.cargo_toml,
    initial_untracked_preserved: failures.filter((failure) => failure.startsWith("initial untracked")).length === 0,
    failures,
  };
  const reconciliationPathOut = resolve(artifactRoot, "reconciliation.json");
  if (existsSync(reconciliationPathOut)) throw new Error(`refusing to overwrite ${rel(reconciliationPathOut)}`);
  mkdirSync(dirname(reconciliationPathOut), { recursive: true });
  writeFileSync(reconciliationPathOut, `${JSON.stringify(reconciliation, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ status: reconciliation.status, output: rel(reconciliationPathOut), failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} else {
  if (existsSync(output)) throw new Error(`refusing to overwrite ${rel(output)}`);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ status: "pass", output: rel(output), untracked_count: untracked.length, cargo: result.cargo_toml }, null, 2));
}
