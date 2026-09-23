#!/usr/bin/env node
/* global console, process */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const workspace = resolve(import.meta.dirname, "../..");
const value = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const runId = value("--run-id") ?? "hotfix41-local";
const output = resolve(workspace, value("--out") ?? `artifacts/phase4/hotfix41/${runId}/preflight.json`);
const relative = (path) => path.slice(workspace.length + 1).replaceAll("\\", "/");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const git = (args) => execFileSync("git", args, { cwd: workspace, encoding: "utf8" });
const cargo = resolve(workspace, "src-tauri/Cargo.toml");
const current = () => {
  const status = git(["status", "--short"]).trim().split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim()).filter((path) => !path.startsWith("artifacts/"));
  return {
    schema_version: 1,
    phase: "hotfix-4.1",
    run_id: runId,
    captured_at: new Date().toISOString(),
    relative_modified_paths: status,
    path_hashes: Object.fromEntries(status.filter((path) => existsSync(resolve(workspace, path)) && statSync(resolve(workspace, path)).isFile()).map((path) => [path, sha256(readFileSync(resolve(workspace, path)))])),
    git_diff_binary_sha256: sha256(git(["diff", "--binary", "--no-ext-diff", "HEAD", "--"])),
    cargo_toml: {
      content_sha256: sha256(readFileSync(cargo)),
      binary_diff_sha256: sha256(git(["diff", "--binary", "--no-ext-diff", "HEAD", "--", "src-tauri/Cargo.toml"])),
    },
    path_policy: "hotfix-owned synthetic tempfile roots only; no external/user filesystem paths",
  };
};
const writeUnique = (path, data) => { if (existsSync(path)) throw new Error(`refusing to overwrite ${relative(path)}`); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx" }); };
if (value("--reconcile")) {
  const baselinePath = resolve(workspace, value("--reconcile"));
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const after = current();
  const failures = [];
  if (baseline.cargo_toml.content_sha256 !== after.cargo_toml.content_sha256) failures.push("Cargo.toml content fingerprint changed");
  if (baseline.cargo_toml.binary_diff_sha256 !== after.cargo_toml.binary_diff_sha256) failures.push("Cargo.toml binary diff fingerprint changed");
  for (const [path, hash] of Object.entries(baseline.path_hashes ?? {})) if (after.path_hashes[path] !== hash) failures.push(`protected path changed: ${path}`);
  const result = { schema_version: 1, phase: "hotfix-4.1", status: failures.length ? "fail" : "pass", baseline: relative(baselinePath), reconciled_at: new Date().toISOString(), protected_state_preserved: failures.length === 0, cargo_toml: after.cargo_toml, failures };
  writeUnique(output, result);
  console.log(JSON.stringify({ status: result.status, output: relative(output), failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} else {
  writeUnique(output, current());
  console.log(JSON.stringify({ status: "pass", output: relative(output) }, null, 2));
}
