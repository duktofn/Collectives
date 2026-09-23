#!/usr/bin/env node
/* global console, process */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const runId = process.argv.includes("--run-id") ? process.argv[process.argv.indexOf("--run-id") + 1] : undefined;
if (!runId) throw new Error("--run-id is required");
const root = resolve(workspace, "artifacts/phase4", runId);
const brief = resolve(root, "visual-brief.json");
const visualBrief = JSON.parse(readFileSync(brief, "utf8"));
const before = resolve(workspace, visualBrief.capture?.before_manifest ?? `artifacts/phase4/${runId}/visual-before-manifest.json`);
const after = visualBrief.capture?.after_manifest ? resolve(workspace, visualBrief.capture.after_manifest) : null;
const dpi = resolve(workspace, visualBrief.dpi_probe ?? "artifacts/phase4/phase4-wp0/windows-dpi-probe.json");
for (const path of [before, brief, dpi]) if (!existsSync(path)) throw new Error(`missing Phase 4 visual evidence: ${path}`);
const manifest = JSON.parse(readFileSync(before, "utf8"));
const afterManifest = after && existsSync(after) ? JSON.parse(readFileSync(after, "utf8")) : null;
const dpiProbe = JSON.parse(readFileSync(dpi, "utf8").replace(/^\uFEFF/, ""));
const failures = [];
if (manifest.status !== "pass" || manifest.png_count !== 81 || manifest.system_match_media !== "light") failures.push("81-image/system manifest contract failed");
if (after && !afterManifest) failures.push("after manifest is declared but missing");
if (afterManifest && (afterManifest.status !== "pass" || afterManifest.png_count !== 81 || afterManifest.system_match_media !== "light")) failures.push("after manifest contract failed");
if (visualBrief.capture?.png_count_before !== 81 || (visualBrief.capture?.png_count_after !== undefined && visualBrief.capture.png_count_after !== 81) || !visualBrief.capture?.matrix?.themes?.includes("system") || visualBrief.capture.matrix.system_match_media !== "light") failures.push("visual brief does not declare System/matchMedia");
if (![125, 150].includes(dpiProbe.dpi_percent)) failures.push(`DPI requirement failed: ${dpiProbe.dpi_percent}%`);
console.log(JSON.stringify({ status: failures.length ? "fail" : "pass", run_id: runId, before_png_count: manifest.png_count, after_png_count: afterManifest?.png_count ?? null, system_match_media: manifest.system_match_media, dpi_percent: dpiProbe.dpi_percent, failures }, null, 2));
if (failures.length) process.exitCode = 1;
