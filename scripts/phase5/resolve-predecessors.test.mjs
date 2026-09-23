#!/usr/bin/env node
/* global process */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { comparable, generateBaseline, resolveCurrent } from "./resolve-predecessors.mjs";

const test = process.env.VITEST ? (await import("vitest")).it : (await import("node:test")).default;
const workspace = resolve(import.meta.dirname, "../..");
const script = resolve(workspace, "scripts/phase5/resolve-predecessors.mjs");
const predecessorRun = "phase5-20260824-feature42-final";
const syntheticParent = resolve(workspace, "artifacts/phase6/phase6-20260825-code3-rev2");

function inventory(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push({ path: relative(workspace, path).replaceAll("\\", "/"), sha256: createHash("sha256").update(readFileSync(path)).digest("hex"), size: statSync(path).size });
    }
  };
  visit(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function run(...args) { return spawnSync(process.execPath, [script, ...args], { cwd: workspace, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }); }
function put(root, path, value) {
  const target = resolve(root, path);
  mkdirSync(resolve(target, ".."), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}
function syntheticFixture(options = {}) {
  const root = mkdtempSync(resolve(syntheticParent, "resolver-fixture-"));
  put(root, "artifacts/phase4/approved-manifest.json", { status: "approved", phase: "phase4", run_id: "phase4-synthetic", visual_review: options.escape ? "../../outside.json" : "artifacts/phase4/review.json", after_manifest: "artifacts/phase4/after.json" });
  put(root, "artifacts/phase4/review.json", { status: "approved_independent_review" });
  put(root, "artifacts/phase4/after.json", { status: "pass" });
  put(root, "artifacts/phase4/hotfix41/approved-manifest.json", { status: "approved", phase: "hotfix-4.1", run_id: "hotfix-synthetic", evidence: "artifacts/phase4/hotfix41/evidence.json", reconciliation: "artifacts/phase4/hotfix41/reconciliation.json" });
  put(root, "artifacts/phase4/hotfix41/evidence.json", { status: options.hotfixFailed ? "fail" : "pass" });
  put(root, "artifacts/phase4/hotfix41/reconciliation.json", { status: "pass" });
  put(root, "artifacts/feature42/approved-manifest.json", { status: "approved", phase: "feature42", run_id: "feature42-synthetic", evidence: "artifacts/feature42/evidence.json", reconciliation: "artifacts/feature42/reconciliation.json", verification: "artifacts/feature42/verification.json" });
  put(root, "artifacts/feature42/evidence.json", { status: "pass", marker: "original" });
  put(root, "artifacts/feature42/reconciliation.json", { status: "pass" });
  put(root, "artifacts/feature42/verification.json", { status: "pass" });
  if (options.ambiguous) put(root, "artifacts/phase4/approved-manifest-alt.json", { status: "approved" });
  return root;
}

test("Phase 6 check mode is byte-read-only across the complete Phase 5 predecessor run", () => {
  const root = resolve(workspace, "artifacts/phase5", predecessorRun);
  const before = inventory(root);
  const result = run("--check", "--run-id", predecessorRun);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"read_only": true/);
  assert.deepEqual(inventory(root), before);
});

test("parser rejects extra positional tokens and mixed/unsafe modes", () => {
  for (const args of [
    ["--check", "--run-id", predecessorRun, predecessorRun],
    ["--check", "--generate", "--run-id", predecessorRun],
    ["--check"],
    ["--check", "--run-id", "../escape"],
    ["--check", "--run-id", "missing-phase6-run"],
    ["--generate", "--run-id", predecessorRun],
  ]) {
    const result = run(...args);
    assert.notEqual(result.status, 0, `${args.join(" ")} unexpectedly passed`);
  }
});

test("synthetic generate succeeds with wx output and never touches a real predecessor", () => {
  const root = syntheticFixture();
  const generated = generateBaseline("phase6-synthetic-success", root, resolve(root, "artifacts/phase5"));
  assert.equal(existsSync(generated.output), true);
  assert.equal(JSON.parse(readFileSync(generated.output, "utf8")).status, "pass");
  assert.throws(() => generateBaseline("phase6-synthetic-success", root, resolve(root, "artifacts/phase5")), /existing/);
});

test("synthetic missing, failed, escaped and ambiguous predecessor cases fail closed", () => {
  assert.throws(() => resolveCurrent("missing", new Date().toISOString(), syntheticFixture({ escape: true })), /escapes/);
  assert.throws(() => resolveCurrent("failed", new Date().toISOString(), syntheticFixture({ hotfixFailed: true })), /not passing/);
  assert.throws(() => resolveCurrent("ambiguous", new Date().toISOString(), syntheticFixture({ ambiguous: true })), /ambiguous/);
  const missingRoot = syntheticFixture();
  const manifest = resolve(missingRoot, "artifacts/phase4/approved-manifest.json");
  writeFileSync(manifest, "corrupt", { flag: "w" });
  assert.throws(() => resolveCurrent("corrupt", new Date().toISOString(), missingRoot));
});

test("synthetic hash conflict is detected by check-equivalent comparison", () => {
  const root = syntheticFixture();
  const generated = generateBaseline("phase6-synthetic-hash", root, resolve(root, "artifacts/phase5"));
  const evidence = resolve(root, "artifacts/feature42/evidence.json");
  writeFileSync(evidence, JSON.stringify({ status: "pass", marker: "mutated" }));
  const current = resolveCurrent("phase6-synthetic-hash", JSON.parse(readFileSync(generated.output, "utf8")).resolved_at, root);
  assert.notDeepEqual(comparable(JSON.parse(readFileSync(generated.output, "utf8"))), comparable(current));
});
