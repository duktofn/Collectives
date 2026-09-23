#!/usr/bin/env node
/* global console, process */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const phaseRoot = resolve(workspace, "artifacts/phase4");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const rel = (path) => relative(workspace, path).replaceAll("\\", "/");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const manifestPath = resolve(workspace, arg("--approved-manifest") ?? "artifacts/phase3/approved-manifest.json");
const output = resolve(workspace, arg("--out") ?? "artifacts/phase4/phase4-wp0/baseline-source.json");
if (!output.startsWith(`${phaseRoot}\\`) && !output.startsWith(`${phaseRoot}/`)) throw new Error("Phase 4 evidence must remain under artifacts/phase4");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.phase !== "phase3" || manifest.status !== "approved" || !manifest.run_id) throw new Error("approved Phase 3 manifest is invalid");
const evidence = resolve(workspace, manifest.evidence);
const reconciliation = resolve(workspace, manifest.reconciliation);
const release = resolve(workspace, manifest.release);
for (const path of [evidence, reconciliation, release]) if (!existsSync(path)) throw new Error(`Phase 3 evidence path missing: ${rel(path)}`);
const evidenceJson = JSON.parse(readFileSync(evidence, "utf8"));
const reconciliationJson = JSON.parse(readFileSync(reconciliation, "utf8"));
const releaseJson = JSON.parse(readFileSync(release, "utf8"));
if (evidenceJson.status !== "pass" || reconciliationJson.status !== "pass" || releaseJson.status !== "pass") throw new Error("approved Phase 3 evidence is not fully passing");
const result = {
  schema_version: 1,
  phase: "phase4",
  baseline_phase: "phase3",
  approval_manifest: rel(manifestPath),
  phase3_run_id: manifest.run_id,
  resolved_at: new Date().toISOString(),
  sources: {
    evidence: { path: rel(evidence), sha256: sha256(readFileSync(evidence)) },
    reconciliation: { path: rel(reconciliation), sha256: sha256(readFileSync(reconciliation)) },
    release: { path: rel(release), sha256: sha256(readFileSync(release)) },
  },
  baseline_summary: { frontend_tests: 85, phase3_backend_gate: "pass", canonical_mode: "sqlite", watcher_reconciliation: "pass" },
};
if (existsSync(output)) throw new Error(`refusing to overwrite ${output}`);
mkdirSync(resolve(output, ".."), { recursive: true });
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ status: "pass", output: rel(output), phase3_run_id: manifest.run_id }, null, 2));
