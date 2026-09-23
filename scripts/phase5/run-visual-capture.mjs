#!/usr/bin/env node
/* global console, process */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const runId = arg("--run-id");
const phase = arg("--phase");
if (!runId || !phase || !["before", "after"].includes(phase)) throw new Error("Usage: --run-id <id> --phase before|after");
const outputRoot = resolve(workspace, "artifacts/phase5", runId);
const captureRoot = resolve(outputRoot, "visual", phase);
const rel = (path) => relative(workspace, path).replaceAll("\\", "/");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function files(path) { return readdirSync(path, { withFileTypes: true }).flatMap((entry) => { const child = join(path, entry.name); return entry.isDirectory() ? files(child) : [child]; }); }
if (process.argv.includes("--check")) {
  const manifest = resolve(outputRoot, `visual-${phase}-manifest.json`);
  if (!existsSync(manifest)) throw new Error(`missing visual manifest ${rel(manifest)}`);
  const data = JSON.parse(readFileSync(manifest, "utf8"));
  if (data.status !== "pass" || data.png_count !== 63 || data.system_match_media !== "light") throw new Error("Phase 5 visual matrix is incomplete");
  console.log(JSON.stringify({ status: "pass", manifest: rel(manifest), png_count: data.png_count }, null, 2));
} else {
  if (existsSync(captureRoot)) throw new Error(`refusing to overwrite ${rel(captureRoot)}`);
  const cli = resolve(workspace, "node_modules/@playwright/test/cli.js");
  execFileSync(process.execPath, [cli, "test", "--config=playwright.phase5.config.ts", "e2e/phase5.visual.spec.ts"], { cwd: workspace, env: { ...process.env, PHASE5_RUN_ID: runId, PHASE5_CAPTURE_PHASE: phase }, stdio: "inherit", timeout: 600_000 });
  const pngs = files(captureRoot).filter((file) => file.endsWith(".png")).sort();
  if (pngs.length !== 63) throw new Error(`expected 63 PNGs, got ${pngs.length}`);
  const manifest = { schema_version: 1, status: "pass", phase: "phase5", run_id: runId, capture_phase: phase, fixture_marker: "workflow-v1", browser: "chromium", system_match_media: "light", generated_at: new Date().toISOString(), png_count: pngs.length, images: pngs.map((file) => ({ path: rel(file), bytes: statSync(file).size, sha256: sha256(readFileSync(file)) })) };
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(resolve(outputRoot, `visual-${phase}-manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ status: "pass", manifest: rel(resolve(outputRoot, `visual-${phase}-manifest.json`)), png_count: pngs.length }, null, 2));
}
