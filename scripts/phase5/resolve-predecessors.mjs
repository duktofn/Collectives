#!/usr/bin/env node
/* global console, process, structuredClone */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, relative, resolve, sep } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const phaseRoot = resolve(workspace, "artifacts/phase5");
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function fail(message) { throw new Error(message); }

export function parseArgs(argv) {
  if (argv.length !== 3 || !["--check", "--generate"].includes(argv[0]) || argv[1] !== "--run-id") fail("usage: --check|--generate --run-id <safe-run-id>");
  const mode = argv[0].slice(2);
  const runId = argv[2];
  if (!SAFE_RUN_ID.test(runId) || runId.includes("..")) fail("unsafe Phase 5 run id");
  return { mode, runId };
}

function pathInside(candidate, root) {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith("../") && !rel.startsWith("..\\") && !/^[A-Za-z]:/.test(rel));
}

function workspacePath(root, relativePath, label) {
  if (typeof relativePath !== "string" || relativePath.length === 0 || relativePath.includes("\0")) fail(`${label} path is invalid`);
  const candidate = resolve(root, relativePath);
  if (!pathInside(candidate, root)) fail(`${label} path escapes workspace`);
  return candidate;
}

function json(filePath) { return JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")); }
function sha256(filePath) { return createHash("sha256").update(readFileSync(filePath)).digest("hex"); }
function requiredFile(filePath, label) { if (!existsSync(filePath) || !lstatSync(filePath).isFile()) fail(`${label} is missing or not a file`); return filePath; }

function assertUniqueManifest(root, relativeManifestPath, expectedPhase) {
  const manifestPath = requiredFile(workspacePath(root, relativeManifestPath, expectedPhase), `${expectedPhase} approved manifest`);
  const directory = dirname(manifestPath);
  const candidates = readdirSync(directory).filter((name) => /^approved-manifest(?:-[A-Za-z0-9._-]+)?\.json$/.test(name));
  if (candidates.length !== 1 || candidates[0] !== "approved-manifest.json") fail(`${expectedPhase} approved manifest is missing or ambiguous`);
  return manifestPath;
}

function requireApprovedManifest(root, relativeManifestPath, expectedPhase, requiredFields) {
  const manifestPath = assertUniqueManifest(root, relativeManifestPath, expectedPhase);
  const manifest = json(manifestPath);
  if (manifest.status !== "approved" || manifest.phase !== expectedPhase || typeof manifest.run_id !== "string" || !SAFE_RUN_ID.test(manifest.run_id)) fail(`${expectedPhase} approved manifest is invalid`);
  for (const field of requiredFields) if (typeof manifest[field] !== "string" || manifest[field].length === 0) fail(`${expectedPhase} approved manifest is missing ${field}`);
  return { manifest, manifestPath };
}

export function resolveCurrent(runId, resolvedAt, root = workspace) {
  const phase4 = requireApprovedManifest(root, "artifacts/phase4/approved-manifest.json", "phase4", ["visual_review", "after_manifest"]);
  const phase4ReviewPath = workspacePath(root, phase4.manifest.visual_review, "phase4 visual review");
  const phase4AfterPath = workspacePath(root, phase4.manifest.after_manifest, "phase4 after manifest");
  requiredFile(phase4ReviewPath, "phase4 visual review");
  requiredFile(phase4AfterPath, "phase4 after manifest");
  if (json(phase4ReviewPath).status !== "approved_independent_review") fail("phase4 visual review is not independently approved");

  const hotfix = requireApprovedManifest(root, "artifacts/phase4/hotfix41/approved-manifest.json", "hotfix-4.1", ["evidence", "reconciliation"]);
  const hotfixEvidence = workspacePath(root, hotfix.manifest.evidence, "hotfix41 evidence");
  const hotfixReconciliation = workspacePath(root, hotfix.manifest.reconciliation, "hotfix41 reconciliation");
  requiredFile(hotfixEvidence, "hotfix41 evidence");
  requiredFile(hotfixReconciliation, "hotfix41 reconciliation");
  if (json(hotfixEvidence).status !== "pass" || json(hotfixReconciliation).status !== "pass") fail("hotfix41 evidence is not passing");

  const feature42 = requireApprovedManifest(root, "artifacts/feature42/approved-manifest.json", "feature42", ["evidence", "reconciliation", "verification"]);
  const featureEvidence = workspacePath(root, feature42.manifest.evidence, "feature42 evidence");
  const featureReconciliation = workspacePath(root, feature42.manifest.reconciliation, "feature42 reconciliation");
  const featureVerification = workspacePath(root, feature42.manifest.verification, "feature42 verification");
  for (const [path, label] of [[featureEvidence, "feature42 evidence"], [featureReconciliation, "feature42 reconciliation"], [featureVerification, "feature42 verification"]]) requiredFile(path, label);
  if (json(featureEvidence).status !== "pass" || json(featureReconciliation).status !== "pass" || json(featureVerification).status !== "pass") fail("feature42 evidence is not passing");

  return {
    schema_version: 1,
    phase: "phase5",
    status: "pass",
    run_id: runId,
    resolved_at: resolvedAt,
    phase4: { run_id: phase4.manifest.run_id, visual_review_sha256: sha256(phase4ReviewPath), after_manifest_sha256: sha256(phase4AfterPath) },
    hotfix41: { run_id: hotfix.manifest.run_id, evidence_sha256: sha256(hotfixEvidence), reconciliation_sha256: sha256(hotfixReconciliation) },
    feature42: { run_id: feature42.manifest.run_id, evidence_sha256: sha256(featureEvidence), reconciliation_sha256: sha256(featureReconciliation), verification_sha256: sha256(featureVerification) },
    fail_closed_policy: "exactly one approved run per Phase 4, Hotfix 4.1 and Feature 4.2 predecessor; no timestamp path literals",
  };
}

export function comparable(value) {
  const copy = structuredClone(value);
  delete copy.resolved_at;
  return copy;
}

export function generateBaseline(runId, root = workspace, artifactRoot = resolve(root, "artifacts/phase5")) {
  if (!pathInside(artifactRoot, resolve(root, "artifacts"))) fail("artifact root escapes workspace artifacts");
  const outputRoot = resolve(artifactRoot, runId);
  const output = resolve(outputRoot, "baseline-source.json");
  if (existsSync(outputRoot)) fail(`refusing to write existing Phase 5 run directory: ${runId}`);
  const result = resolveCurrent(runId, new Date().toISOString(), root);
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  return { result, outputRoot, output };
}

export function main(argv = process.argv.slice(2)) {
  const { mode, runId } = parseArgs(argv);
  const outputRoot = resolve(phaseRoot, runId);
  const output = resolve(outputRoot, "baseline-source.json");
  if (!pathInside(outputRoot, phaseRoot)) fail("output path escapes Phase 5 artifact root");
  if (mode === "check") {
    requiredFile(output, "existing Phase 5 baseline-source.json");
    const baseline = json(output);
    if (baseline.run_id !== runId) fail("baseline run id does not match --run-id");
    const expected = resolveCurrent(runId, baseline.resolved_at);
    if (JSON.stringify(comparable(baseline)) !== JSON.stringify(comparable(expected))) fail("predecessor identity, status or hash is stale/conflicting");
    console.log(JSON.stringify({ status: "pass", mode, run_id: runId, output: `artifacts/phase5/${runId}/baseline-source.json`, read_only: true }, null, 2));
    return;
  }
  const generated = generateBaseline(runId);
  console.log(JSON.stringify({ status: generated.result.status, mode, run_id: runId, output: `artifacts/phase5/${runId}/baseline-source.json`, created_only: "baseline-source.json" }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
