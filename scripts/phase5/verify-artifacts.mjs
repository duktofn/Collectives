#!/usr/bin/env node
/* global console, process */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const runId = process.argv.includes("--run-id") ? process.argv[process.argv.indexOf("--run-id") + 1] : undefined;
if (!runId || !/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error("--run-id is required");
const root = resolve(workspace, "artifacts/phase5", runId);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const failures = [];
for (const phase of ["before", "after"]) {
  const manifestPath = resolve(root, `visual-${phase}-manifest.json`);
  if (!existsSync(manifestPath)) { failures.push(`missing ${phase} manifest`); continue; }
  const manifest = readJson(manifestPath);
  if (manifest.status !== "pass" || manifest.png_count !== 63 || manifest.system_match_media !== "light") failures.push(`${phase} matrix contract failed`);
  for (const image of manifest.images ?? []) {
    const path = resolve(workspace, image.path);
    if (!existsSync(path) || hash(path) !== image.sha256) failures.push(`image missing/hash mismatch: ${image.path}`);
  }
}
const baseline = resolve(root, "baseline-source.json");
const preflight = resolve(root, "preflight.json");
const reconciliation = resolve(root, "reconciliation.json");
const visualReview = resolve(root, "visual-review.json");
for (const path of [baseline, preflight, reconciliation, visualReview]) if (!existsSync(path)) failures.push(`missing evidence: ${path}`);
if (existsSync(baseline)) {
  const baselineSource = readJson(baseline);
  if (baselineSource.feature42?.run_id !== "feature42-20260824-final9") failures.push("Feature 4.2 approved predecessor is missing or not selected");
}
if (existsSync(reconciliation) && readJson(reconciliation).status !== "pass") failures.push("reconciliation failed");
if (existsSync(visualReview) && !["pending_independent_review", "approved_independent_review"].includes(readJson(visualReview).status)) failures.push("visual review status invalid");
console.log(JSON.stringify({ status: failures.length ? "fail" : "pass", phase: "phase5", run_id: runId, png_count_per_phase: 63, visual_review: existsSync(visualReview) ? readJson(visualReview).status : "missing", failures }, null, 2));
if (failures.length) process.exitCode = 1;
