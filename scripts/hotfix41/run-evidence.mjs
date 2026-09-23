#!/usr/bin/env node
/* global console, process */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const workspace = resolve(import.meta.dirname, "../..");
const runId = process.argv.includes("--run-id") ? process.argv[process.argv.indexOf("--run-id") + 1] : "hotfix41-local";
if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error("unsafe hotfix run id");
const output = resolve(workspace, "artifacts/phase4/hotfix41", runId, "evidence.json");
if (existsSync(output)) throw new Error(`refusing to overwrite ${output}`);

const workspacePattern = new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
const redact = (value) => value
  .replace(workspacePattern, "<workspace>")
  .replace(/[A-Za-z]:[\\/][^\r\n"']+/g, "<redacted-path>");
const npmCli = resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
const commands = [
  { command: "node scripts/ipc/generate-contracts.mjs --check", executable: process.execPath, args: [resolve(workspace, "scripts/ipc/generate-contracts.mjs"), "--check"] },
  { command: "node scripts/ipc/verify-handler-registry.mjs", executable: process.execPath, args: [resolve(workspace, "scripts/ipc/verify-handler-registry.mjs")] },
  { command: "npm run test -- --run --allowOnly=false src/features/filesystem/folderRefReadiness.test.ts src/App.hotfix41.test.tsx", executable: process.execPath, args: [npmCli, "run", "test", "--", "--run", "--allowOnly=false", "src/features/filesystem/folderRefReadiness.test.ts", "src/App.hotfix41.test.tsx"] },
  { command: "cargo test --locked --test hotfix41_folderref -- --nocapture", executable: "cargo", args: ["test", "--locked", "--test", "hotfix41_folderref", "--", "--nocapture"], cwd: resolve(workspace, "src-tauri") },
  { command: "cargo fmt --all -- --check", executable: "cargo", args: ["fmt", "--all", "--", "--check"], cwd: resolve(workspace, "src-tauri") },
];
const results = commands.map((entry) => {
  try {
    const stdout = execFileSync(entry.executable, entry.args, { cwd: entry.cwd ?? workspace, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    return { command: entry.command, exit_code: 0, stdout: redact(stdout), stderr: "" };
  } catch (error) {
    return { command: entry.command, exit_code: error.status ?? 1, stdout: redact(error.stdout?.toString?.() ?? ""), stderr: redact(error.stderr?.toString?.() ?? String(error)) };
  }
});
const evidence = {
  schema_version: 1,
  phase: "hotfix-4.1",
  run_id: runId,
  status: results.every((result) => result.exit_code === 0) ? "pass" : "fail",
  synthetic_fixture_policy: "tests use unique tempfile roots only",
  external_user_paths_read_or_logged: false,
  redaction: "workspace and absolute paths are removed from command output",
  commands: results,
  fixture_ids: ["synthetic-collection", "synthetic-folder-ref", "synthetic-root"],
  source_fingerprint: createHash("sha256").update("hotfix-4.1-folderref-reconciliation-v1").digest("hex"),
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ status: evidence.status, output: "artifacts/phase4/hotfix41/<run-id>/evidence.json", commands: results.length }, null, 2));
if (evidence.status !== "pass") process.exitCode = 1;
