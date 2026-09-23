#!/usr/bin/env node
/* global console, process */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const value = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const runId = value("--run-id");
if (!runId || !/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error("--run-id is required and must be safe");
const root = resolve(workspace, "artifacts/feature42", runId);
const rel = (path) => relative(workspace, path).replaceAll("\\", "/");
const json = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const forbiddenAbsolute = /(?:[A-Za-z]:[\\/](?:Users|home)[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/i;
const containsForbiddenPath = (value) => {
  if (typeof value === "string") return forbiddenAbsolute.test(value);
  if (Array.isArray(value)) return value.some(containsForbiddenPath);
  if (value && typeof value === "object") return Object.values(value).some(containsForbiddenPath);
  return false;
};
const failures = [];
const required = ["baseline-source.json", "preflight.json", "evidence.json", "synthetic-evidence.json", "reconciliation.json"];
for (const file of required) if (!existsSync(resolve(root, file))) failures.push(`missing ${file}`);
let baseline;
let preflight;
let evidence;
let reconciliation;
if (!failures.length) {
  baseline = json(resolve(root, "baseline-source.json"));
  preflight = json(resolve(root, "preflight.json"));
  evidence = json(resolve(root, "evidence.json"));
  reconciliation = json(resolve(root, "reconciliation.json"));
  if (baseline.status !== "pass" || preflight.run_id !== runId || evidence.status !== "pass" || reconciliation.status !== "pass") failures.push("baseline/preflight/evidence/reconciliation status contract failed");
  if (baseline.hotfix41?.run_id !== "hotfix41-20260824-final4") failures.push("unexpected Hotfix 4.1 source run");
  if (preflight.cargo_toml?.content_sha256 !== "20202baf2da1bc0c1842a33774eaf3a573b830901a1b791e5d670a8ad46dacba") failures.push("Cargo.toml content fingerprint changed");
  if (preflight.cargo_toml?.binary_diff_sha256 !== "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855") failures.push("Cargo.toml binary diff fingerprint changed");
  for (const command of evidence.commands ?? []) {
    if (command.status !== "pass" || command.exit_code !== 0) failures.push(`command failed: ${command.name}`);
    if (!existsSync(resolve(workspace, command.log))) failures.push(`missing command log: ${command.name}`);
    if (containsForbiddenPath(command.command ?? "")) failures.push(`unredacted path in command provenance: ${command.name}`);
    if (containsForbiddenPath(command.output_tail ?? "")) failures.push(`unredacted path in command output: ${command.name}`);
  }
  const syntheticPath = resolve(workspace, evidence.synthetic?.path ?? "");
  if (!existsSync(syntheticPath) || sha(syntheticPath) !== evidence.synthetic?.sha256) failures.push("synthetic evidence hash mismatch");
  if (evidence.redaction?.external_user_paths_read_or_logged !== false) failures.push("synthetic redaction policy failed");
  if (containsForbiddenPath({ baseline, preflight, evidence, reconciliation })) failures.push("absolute external/user path found in evidence JSON");
}
const output = resolve(root, "verification.json");
const result = { schema_version: 1, phase: "feature42", run_id: runId, status: failures.length ? "fail" : "pass", checked_at: new Date().toISOString(), predecessor: baseline?.hotfix41 ?? null, command_count: evidence?.commands?.length ?? 0, failures };
if (existsSync(output)) throw new Error(`refusing to overwrite ${rel(output)}`);
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ ...result, output: rel(output) }, null, 2));
if (failures.length) process.exitCode = 1;
