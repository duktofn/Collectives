#!/usr/bin/env node
/* global console, process */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const phase = arg("--phase");
const runId = arg("--run-id");
if (phase !== "phase4" || !runId || !/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error("Usage: --phase phase4 --run-id <safe-run-id>");

const root = resolve(workspace, "artifacts/phase4", runId);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const relative = (path) => path.startsWith(workspace) ? path.slice(workspace.length + 1).replaceAll("\\", "/") : path;
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const failures = [];
const required = ["visual-brief.json", "visual-review.json"];
for (const file of required) if (!existsSync(resolve(root, file))) failures.push(`missing ${file}`);
if (failures.length) {
  console.log(JSON.stringify({ status: "fail", phase, run_id: runId, failures }, null, 2));
  process.exitCode = 1;
}
if (failures.length) process.exit();

const brief = readJson(resolve(root, "visual-brief.json"));
const review = readJson(resolve(root, "visual-review.json"));
const beforePath = resolve(workspace, brief.capture.before_manifest);
const afterPath = resolve(root, "visual-after-manifest.json");
for (const path of [beforePath, afterPath]) if (!existsSync(path)) failures.push(`missing visual manifest ${relative(path)}`);

function validateManifest(path, expectedPhase) {
  if (!existsSync(path)) return;
  const manifest = readJson(path);
  if (manifest.status !== "pass" || manifest.phase !== "phase4" || manifest.capture_phase !== expectedPhase) failures.push(`invalid ${relative(path)} status/phase`);
  if (manifest.png_count !== 81 || manifest.system_match_media !== "light") failures.push(`invalid ${relative(path)} matrix contract`);
  const seen = new Set();
  for (const image of manifest.images ?? []) {
    const imagePath = resolve(workspace, image.path);
    if (seen.has(image.path)) failures.push(`duplicate image path ${image.path}`);
    seen.add(image.path);
    if (!existsSync(imagePath)) failures.push(`missing image ${image.path}`);
    else if (hash(imagePath) !== image.sha256) failures.push(`hash mismatch ${image.path}`);
  }
  if (seen.size !== 81) failures.push(`expected 81 unique images in ${relative(path)}, got ${seen.size}`);
}
validateManifest(beforePath, "before");
validateManifest(afterPath, "after");

if (brief.capture?.png_count_before !== 81 || brief.capture?.png_count_after !== 81) failures.push("brief does not declare 81 before/after PNGs");
if (JSON.stringify(brief.capture?.matrix?.themes) !== JSON.stringify(["dark", "light", "system"])) failures.push("brief theme matrix is not dark/light/system");
if (brief.capture?.matrix?.system_match_media !== "light") failures.push("brief lacks controlled System=light condition");
const signedReview = review.status === "signed" || review.status === "approved_independent_review";
if (review.status !== "pending_independent_visual_review" && !signedReview) failures.push("visual review status is invalid");
if (signedReview && (!review.reviewer || !review.signed_at)) failures.push("signed visual review lacks reviewer/timestamp");

const status = failures.length ? "fail" : signedReview ? "pass" : "pending_independent_visual_review";
const result = {
  status,
  phase,
  run_id: runId,
  before_manifest: relative(beforePath),
  after_manifest: relative(afterPath),
  before_after_png_count: failures.length ? null : 162,
  visual_review: review.status,
  failures,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
