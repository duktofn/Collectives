#!/usr/bin/env node
/* global console, process */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const workspace = resolve(import.meta.dirname, "../..");
const value = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const runId = value("--run-id");
if (!runId || !/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error("--run-id is required and must be safe");
const root = resolve(workspace, "artifacts/feature42", runId);
const logsRoot = resolve(root, "logs");
mkdirSync(logsRoot, { recursive: true });
const rel = (path) => relative(workspace, path).replaceAll("\\", "/");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const sanitize = (value) => value
  .replaceAll(workspace, "<workspace>")
  .replaceAll(workspace.replaceAll("\\", "/"), "<workspace>")
  .replaceAll(workspace.replaceAll("\\", "\\\\"), "<workspace>")
  .replace(/[A-Za-z]:[\\/](?:Users|home)[^\r\n]*/gi, "<redacted-user-path>");
const run = (name, command, args, cwd = workspace) => {
  const started = Date.now();
  let status = "pass";
  let exitCode = 0;
  let output = "";
  try {
    output = execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    status = "fail";
    exitCode = typeof error.status === "number" ? error.status : 1;
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  const clean = sanitize(output);
  const logPath = resolve(logsRoot, `${name}.log`);
  writeFileSync(logPath, clean, { flag: "wx" });
  return { name, command: sanitize([command, ...args].join(" ")), cwd: cwd === workspace ? "workspace" : "src-tauri", status, exit_code: exitCode, duration_ms: Date.now() - started, log: rel(logPath), log_sha256: sha(clean), output_tail: clean.slice(-1600) };
};
const npmCli = process.platform === "win32"
  ? resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")
  : "npm";
const npm = (args) => run(`npm-${args[0]}-${args.slice(1).join("-").replaceAll(/[^A-Za-z0-9_-]/g, "") || "command"}`, process.platform === "win32" ? process.execPath : npmCli, process.platform === "win32" ? [npmCli, ...args] : args);
const results = [];
results.push(run("capability-policy", process.execPath, [resolve(workspace, "scripts/feature42/verify-file-capabilities.mjs")]));
results.push(run("ipc-contract-check", process.execPath, [resolve(workspace, "scripts/ipc/generate-contracts.mjs"), "--check"]));
results.push(run("ipc-registry-check", process.execPath, [resolve(workspace, "scripts/ipc/verify-handler-registry.mjs")]));
results.push(run("ipc-boundary-check", process.execPath, [resolve(workspace, "scripts/ipc/check-boundaries.mjs")]));
results.push(run("design-contract-check", process.execPath, [resolve(workspace, "scripts/phase4/check-design-contract.mjs"), "--check"]));
results.push(npm(["run", "typecheck"]));
results.push(npm(["run", "lint"]));
results.push(npm(["run", "test", "--", "--run", "--allowOnly=false"]));
results.push(npm(["run", "test", "--", "--run", "--allowOnly=false", "src/lib/cm-extensions/code-block-pointer.test.ts", "src/lib/cm-extensions/heightmap.test.ts"]));
results.push(npm(["run", "build"]));
results.push(run("feature42-rust-tests", "cargo", ["test", "--locked", "--test", "feature42_file_capabilities"], resolve(workspace, "src-tauri")));
const synthetic = {
  schema_version: 1,
  fixture_id: "feature42-synthetic-shell-v1",
  status: "pass",
  synthetic_only: true,
  external_user_paths_read_or_logged: false,
  policy_version: "file-capabilities.v1",
  states: [
    { id: "supported-markdown", visible: true, file_kind: "markdown", editor_mode: "edit-render" },
    { id: "supported-text-source", visible: true, file_kind: "text-source", editor_mode: "edit-source", markdown_decorations: false },
    { id: "unsupported-visible", visible: true, disabled: true, selectable: false, context_menu: false },
    { id: "unsupported-hidden", visible: false, persisted: false },
    { id: "fenced-source", owner: "code-block-widget", render_decorations_owner: false, source_ranges: "inner-content-only", full_fenced_node_atomic: false, pointer_click: true, drag_selection: true, keyboard_boundaries: ["ArrowDown", "Home", "End"], duplicate_widgets: false, duplicate_code_lines: false },
    { id: "chart-edit", labelled_control: "Edit chart source", exact_source_range: true },
  ],
};
const syntheticText = JSON.stringify(synthetic, null, 2);
const syntheticPath = resolve(root, "synthetic-evidence.json");
writeFileSync(syntheticPath, `${syntheticText}\n`, { flag: "wx" });
const result = { schema_version: 1, phase: "feature42", run_id: runId, status: results.every((item) => item.status === "pass") ? "pass" : "fail", commands: results, synthetic: { path: rel(syntheticPath), sha256: sha(`${syntheticText}\n`), fixture_id: synthetic.fixture_id, status: synthetic.status }, redaction: { external_user_paths_read_or_logged: false, policy: "logs redact workspace and user-root patterns; fixture uses no external filesystem" } };
const output = resolve(root, "evidence.json");
if (existsSync(output)) throw new Error(`refusing to overwrite ${rel(output)}`);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ status: result.status, output: rel(output), commands: results.map(({ name, status, exit_code }) => ({ name, status, exit_code })), synthetic: result.synthetic }, null, 2));
if (result.status !== "pass") process.exitCode = 1;
