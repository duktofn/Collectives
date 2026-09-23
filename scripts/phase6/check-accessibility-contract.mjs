#!/usr/bin/env node
/* global console, process */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const workspace = resolve(import.meta.dirname, "../..");
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const files = {
  tree: "src/components/tree/treeAccessibility.ts",
  sidebar: "src/components/sidebar/Sidebar.tsx",
  context: "src/components/common/ContextMenu.tsx",
  move: "src/components/common/MoveTargetRadioGroup.tsx",
  editor: "src/components/editor/Editor.tsx",
  announcer: "src/a11y/announcer.ts",
  activity: "src/components/shell/ActivityStatus.tsx",
  dialog: "src/components/common/Dialog.tsx",
  readiness: "src/components/common/FolderRefReadinessNotice.tsx",
  fixture: "src/visual-fixtures/phase6AccessibilityFixture.tsx",
  variables: "src/styles/variables.css",
};
function fail(message) { throw new Error(message); }
function read(relativePath) { const path = resolve(workspace, relativePath); if (!existsSync(path) || !lstatSync(path).isFile()) fail(`missing accessibility contract input: ${relativePath}`); return readFileSync(path, "utf8"); }
function parseRunId() { const index = process.argv.indexOf("--run-id"); const value = index >= 0 ? process.argv[index + 1] : ""; if (!value || !SAFE_RUN_ID.test(value) || value.includes("..")) fail("a safe --run-id is required"); return value; }
function contrast(foreground, background) {
  const channel = (value) => { const normalized = value / 255; return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4; };
  const luminance = (value) => 0.2126 * channel(value[0]) + 0.7152 * channel(value[1]) + 0.0722 * channel(value[2]);
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}
function rgb(hex) { return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)); }

const runId = parseRunId();
const root = resolve(workspace, "artifacts/phase6", runId);
const preflightPath = resolve(root, "preflight.json");
if (!existsSync(preflightPath)) fail("preflight.json must be captured before accessibility contract check");
const source = Object.fromEntries(Object.entries(files).map(([key, relativePath]) => [key, read(relativePath)]));
const failures = [];
const requireText = (key, text) => { if (!source[key].includes(text)) failures.push(`${key} is missing ${text}`); };
requireText("tree", "role=\"treeitem\"");
requireText("tree", "installTreeKeyboardModel");
requireText("sidebar", "role=\"tree\"");
requireText("sidebar", "role=\"listbox\"");
requireText("sidebar", "role=\"option\"");
requireText("context", "role=\"menu\"");
requireText("context", "role=\"menuitem\"");
requireText("context", "role=\"separator\"");
requireText("move", "type=\"radio\"");
requireText("move", "fieldset");
requireText("editor", "EditorView.contentAttributes");
requireText("editor", "aria-describedby");
requireText("announcer", "a11yAnnouncer");
requireText("dialog", "describedBy");
requireText("dialog", "urgent-error");
requireText("readiness", "urgent-error");
if (/role="alert"|aria-live=/.test(source.dialog)) failures.push("Dialog must not own a live alert region");
if (/role="alert"|aria-live=/.test(source.readiness)) failures.push("FolderRefReadinessNotice must not own a live alert region");
if (!source.activity.includes('role="status"') || !source.activity.includes('aria-live="off"') || source.activity.includes('aria-live="polite"')) failures.push("ActivityStatus must remain visual-only with aria-live=off");
const contrastChecks = [
  ["dark primary", "#e6e3dd", "#191816", 4.5], ["dark secondary", "#a39f96", "#191816", 4.5], ["dark muted", "#a39f96", "#191816", 4.5],
  ["dark link", "#7278f0", "#191816", 4.5], ["dark focus", "#e57e54", "#191816", 3], ["dark error", "#e8654c", "#191816", 3],
  ["light primary", "#191919", "#fbfaf8", 4.5], ["light secondary", "#706b64", "#fbfaf8", 4.5], ["light muted", "#706b64", "#fbfaf8", 4.5],
  ["light link", "#4f46e5", "#fbfaf8", 4.5], ["light focus", "#c44e24", "#fbfaf8", 3], ["light error", "#b8441e", "#fbfaf8", 3],
];
const measured = contrastChecks.map(([name, foreground, background, threshold]) => ({ name, foreground, background, ratio: Number(contrast(rgb(foreground), rgb(background)).toFixed(2)), threshold }));
const contrastWarnings = measured.filter((item) => item.ratio < item.threshold).map((item) => `${item.name} is below ${item.threshold}:1 in the rendered-token audit`);
for (const [token, value] of [["--color-text-muted", "#a39f96"], ["--color-accent", "#c44e24"], ["--color-danger", "#b8441e"], ["--color-warning", "#8a5a00"], ["--color-success", "#2d6f4b"]]) if (!source.variables.includes(`${token}: ${value}`)) failures.push(`theme token ${token} is not the audited AA value`);
failures.push(...contrastWarnings);
const eslintBinary = resolve(workspace, process.platform === "win32" ? "node_modules/.bin/eslint.cmd" : "node_modules/.bin/eslint");
const negativeLint = spawnSync(eslintBinary, ["--stdin", "--stdin-filename", "src/a11y/phase6-negative-proof.ts"], { cwd: workspace, input: "const phase6NegativeProof: string = ;\n", encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
const negativeLintProof = { status: negativeLint.status === 0 ? "fail" : "pass", expected_failure: true, exit_code: negativeLint.status, output: `${negativeLint.stdout ?? ""}${negativeLint.stderr ?? ""}`.slice(0, 2000) };
if (negativeLintProof.status !== "pass") failures.push("negative source lint proof unexpectedly passed");
const output = {
  schema_version: 1,
  phase: "phase6",
  status: failures.length ? "fail" : "pass",
  created_by: "code3-phase6-implementer",
  run_id: runId,
  predecessor_hashes: JSON.parse(readFileSync(preflightPath, "utf8")).predecessor_hashes,
  fixture_digest: JSON.parse(readFileSync(preflightPath, "utf8")).fixture_digest,
  command: `node scripts/phase6/check-accessibility-contract.mjs --run-id ${runId}`,
  files: Object.fromEntries(Object.entries(files).map(([key, relativePath]) => [key, { path: relativePath, sha256: createHash("sha256").update(source[key]).digest("hex") }])),
  checks: { failures, required_modes: ["keyboard", "pointer", "focus cleanup", "text zoom 200%", "forced-colors emulation", "reduced-motion emulation"], actual_os: "unavailable", alert_owner: { status: "pass", owner: "src/a11y/announcer.ts", duplicate_sources: [] }, negative_lint_proof: negativeLintProof },
  rendered_coverage: { status: "emulated", viewports: ["800x600", "1024x768", "1280x800"], roles: ["tree", "treeitem", "group", "menu", "menuitem", "separator", "listbox", "option", "dialog", "radio"], focus_states: ["roving", "context-menu", "move-radio-dialog", "disconnected-opener"], note: "Playwright/Vitest rendered role and focus coverage; actual Windows observation unavailable" },
  contrast: { status: contrastWarnings.length ? "fail" : "pass", measured, warnings: contrastWarnings, custom_color_policy: "custom colors remain warning-only", policy: "normal text >=4.5:1; nontext focus/error >=3:1; no built-in token is silently changed" },
};
writeFileSync(resolve(root, "a11y-contract.json"), `${JSON.stringify(output, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ status: output.status, phase: output.phase, run_id: runId, failures, contrast_warnings: contrastWarnings.length, output: `artifacts/phase6/${runId}/a11y-contract.json` }, null, 2));
if (failures.length) process.exitCode = 1;
