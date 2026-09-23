#!/usr/bin/env node
/* global console, process */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const value = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const runId = value("--run-id") ?? "feature42-baseline";
if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error("unsafe Feature 4.2 run id");

const rel = (path) => relative(workspace, path).replaceAll("\\", "/");
const json = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const insideWorkspace = (path) => {
  const candidate = resolve(workspace, path);
  return candidate === workspace || candidate.startsWith(`${workspace}${process.platform === "win32" ? "\\" : "/"}`);
};
const approvedPath = resolve(workspace, "artifacts/phase4/hotfix41/approved-manifest.json");
if (!existsSync(approvedPath)) throw new Error("approved Hotfix 4.1 manifest is missing");
const approved = json(approvedPath);
if (approved.status !== "approved" || approved.phase !== "hotfix-4.1" || !approved.run_id || !approved.evidence || !approved.reconciliation) {
  throw new Error("approved Hotfix 4.1 manifest is invalid");
}
for (const target of [approved.evidence, approved.reconciliation]) {
  if (!insideWorkspace(target)) throw new Error("Hotfix 4.1 evidence path is outside the workspace");
}
const evidencePath = resolve(workspace, approved.evidence);
const reconciliationPath = resolve(workspace, approved.reconciliation);
if (!existsSync(evidencePath) || !existsSync(reconciliationPath)) throw new Error("Hotfix 4.1 evidence target is missing");
const evidence = json(evidencePath);
const reconciliation = json(reconciliationPath);
if (evidence.status !== "pass" || reconciliation.status !== "pass") throw new Error("Hotfix 4.1 evidence is not passing");

const output = resolve(workspace, "artifacts/feature42", runId, "baseline-source.json");
if (existsSync(output)) throw new Error(`refusing to overwrite ${rel(output)}`);
const result = {
  schema_version: 1,
  phase: "feature42",
  status: "pass",
  run_id: runId,
  resolved_at: new Date().toISOString(),
  hotfix41: {
    run_id: approved.run_id,
    approved_manifest_sha256: sha256(approvedPath),
    evidence: rel(evidencePath),
    evidence_sha256: sha256(evidencePath),
    reconciliation: rel(reconciliationPath),
    reconciliation_sha256: sha256(reconciliationPath),
  },
  fail_closed_policy: "exactly one approved Hotfix 4.1 manifest pointer; no timestamp path scan",
  redaction_policy: "workspace-relative evidence only; no external or user filesystem paths",
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ status: result.status, output: rel(output), hotfix41_run_id: approved.run_id }, null, 2));
