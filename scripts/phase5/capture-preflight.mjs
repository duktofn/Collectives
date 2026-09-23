#!/usr/bin/env node
/* global console, process */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";

const workspace = resolve(import.meta.dirname, "../..");
const value = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const runId = value("--run-id") ?? "phase5-local";
const out = resolve(workspace, "artifacts/phase5", runId, "preflight.json");
const rel = (path) => path.slice(workspace.length + 1).replaceAll("\\", "/");
const sha = (data) => createHash("sha256").update(data).digest("hex");
const git = (args) => execFileSync("git", args, { cwd: workspace, encoding: "utf8" });
const cargo = resolve(workspace, "src-tauri/Cargo.toml");
const makeRecord = () => {
  const status = git(["status", "--short"]).trim().split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim()).filter((path) => !path.startsWith("artifacts/"));
  return { schema_version: 1, phase: "phase5", run_id: runId, captured_at: new Date().toISOString(), relative_modified_paths: status, path_hashes: Object.fromEntries(status.filter((path) => existsSync(resolve(workspace, path)) && statSync(resolve(workspace, path)).isFile()).map((path) => [path, sha(readFileSync(resolve(workspace, path)))])), cargo_toml: { content_sha256: sha(readFileSync(cargo)), binary_diff_sha256: sha(git(["diff", "--binary", "--no-ext-diff", "HEAD", "--", "src-tauri/Cargo.toml"])) }, protected: ["stores", "backend", "IPC", "package", "Cargo", "Phase 0-4 artifacts"] };
};
const writeUnique = (path, data) => { if (existsSync(path)) throw new Error(`refusing to overwrite ${rel(path)}`); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx" }); };
if (value("--reconcile")) {
  const baselinePath = resolve(workspace, value("--reconcile"));
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const current = makeRecord();
  const failures = [];
  if (baseline.cargo_toml.content_sha256 !== current.cargo_toml.content_sha256) failures.push("Cargo.toml content fingerprint changed");
  if (baseline.cargo_toml.binary_diff_sha256 !== current.cargo_toml.binary_diff_sha256) failures.push("Cargo.toml binary diff fingerprint changed");
  for (const [path, hash] of Object.entries(baseline.path_hashes ?? {})) if (current.path_hashes[path] !== hash) failures.push(`protected path changed: ${path}`);
  const result = { schema_version: 1, phase: "phase5", status: failures.length ? "fail" : "pass", baseline: rel(baselinePath), reconciled_at: new Date().toISOString(), protected_state_preserved: failures.length === 0, cargo_toml: current.cargo_toml, failures };
  writeUnique(out.replace(/preflight\.json$/, "reconciliation.json"), result);
  console.log(JSON.stringify({ status: result.status, output: rel(out.replace(/preflight\.json$/, "reconciliation.json")), failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} else {
  const record = makeRecord();
  writeUnique(out, record);
  console.log(JSON.stringify({ status: "pass", output: rel(out), cargo: record.cargo_toml }, null, 2));
}
