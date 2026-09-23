#!/usr/bin/env node
/* global console, process */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, parse, relative, resolve } from 'node:path';
import os from 'node:os';

const workspace = resolve(import.meta.dirname, '../..');
const cargo = 'src-tauri/Cargo.toml';
const phaseRoot = resolve(workspace, 'artifacts/phase3');
const phase3MutablePrefixes = ['.github/workflows/phase3-performance.yml', 'contracts/ipc.v1.json', 'src-tauri/src/lib.rs', 'src-tauri/src/application/', 'src-tauri/src/repositories/', 'src-tauri/src/ipc/', 'src-tauri/src/metadata/', 'src-tauri/src/bin/phase3_', 'src-tauri/src/fs_layer/watcher.rs', 'src/components/tree/FolderRefNode.tsx', 'src/stores/editor.ts', 'src/stores/collections.ts', 'src/stores/collections.phase3', 'src/features/collections/', 'src/features/filesystem/', 'src/features/editor/', 'src/shared/ipc/', 'src-tauri/tests/phase3_', 'scripts/ipc/', 'scripts/phase3/', 'docs/rebuild/phase-3-'];

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function git(args, encoding = 'buffer') { return execFileSync('git', args, { cwd: workspace, encoding }); }
function rel(path) { return relative(workspace, path).replaceAll('\\', '/'); }
function fileHash(path) {
  const absolute = resolve(workspace, path);
  return existsSync(absolute) && lstatSync(absolute).isFile() ? sha256(readFileSync(absolute)) : null;
}
function inventory() {
  return git(['ls-files', '--others', '--exclude-standard', '-z']).toString('utf8').split('\0').filter(Boolean).map((path) => {
    const absolute = resolve(workspace, path);
    const stat = statSync(absolute);
    return { path, bytes: stat.isFile() ? stat.size : null, sha256: stat.isFile() ? sha256(readFileSync(absolute)) : null, regular_file: stat.isFile() };
  });
}
function statusPaths() {
  return git(['status', '--short'], 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim()).filter(Boolean);
}
function safeOutput(value) {
  const output = resolve(workspace, value);
  const workspacePrefix = `${workspace}${process.platform === 'win32' ? '\\' : '/'};`;
  const forbidden = [process.env.APPDATA, process.env.LOCALAPPDATA, process.env.ProgramData, process.env.TEMP, process.env.TMP].filter(Boolean).map((path) => resolve(path));
  if (output === workspace || output === parse(output).root || !output.startsWith(workspacePrefix.slice(0, -1)) || forbidden.some((root) => output === root)) {
    throw new Error(`unsafe Phase 3 artifact path: ${output}`);
  }
  if (!output.startsWith(`${phaseRoot}${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error('Phase 3 artifacts must remain under artifacts/phase3');
  return output;
}
function tool(command, args = []) {
  try { return { path: execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], { cwd: workspace, encoding: 'utf8' }).trim().split(/\r?\n/)[0], version: execFileSync(command, args, { cwd: workspace, encoding: 'utf8' }).trim() }; }
  catch { return { path: null, version: 'unavailable' }; }
}
function writeUnique(path, value) {
  if (existsSync(path)) throw new Error(`refusing to overwrite existing artifact: ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}
function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out') result.out = argv[++index];
    else if (argv[index] === '--reconcile') result.reconcile = argv[++index];
    else if (argv[index] === '--approved-phase2-manifest') result.approvedPhase2 = argv[++index];
  }
  return result;
}
function capture(out, approvedPhase2) {
  const paths = statusPaths();
  const record = {
    schema_version: 1,
    phase: 'phase3',
    run_id: basename(dirname(out)),
    captured_at: new Date().toISOString(),
    workspace_root: workspace,
    head_sha: git(['rev-parse', 'HEAD'], 'utf8').trim(),
    git_diff_binary_sha256: sha256(git(['diff', '--binary', '--no-ext-diff', 'HEAD', '--'])),
    protected_modified_paths: paths.filter((path) => !path.startsWith('artifacts/')),
    protected_path_hashes: Object.fromEntries(paths.filter((path) => !path.startsWith('artifacts/')).map((path) => [path, fileHash(path)])),
    untracked_inventory: inventory(),
    cargo_toml: { content_sha256: fileHash(cargo), binary_diff_sha256: sha256(git(['diff', '--binary', '--no-ext-diff', 'HEAD', '--', cargo])) },
    approved_phase2_manifest: approvedPhase2 ? rel(resolve(workspace, approvedPhase2)) : null,
    toolchain: { node: tool('node', ['--version']), npm: tool('npm', ['--version']), rustc: tool('rustc', ['--version']), cargo: tool('cargo', ['--version']) },
    host: { platform: process.platform, release: os.release(), arch: process.arch, cpu_count: os.cpus().length, total_memory: os.totalmem() },
    path_policy: {
      artifact_root: 'artifacts/phase3/<run-id>',
      protected_existing_paths: 'All preflight modified and untracked paths retain their content and are never deleted.',
      planned_new_prefixes: ['src-tauri/src/metadata/', 'src-tauri/tests/phase3_', 'scripts/phase3/', 'docs/rebuild/phase-3-', 'artifacts/phase3/'],
      phase3_mutable_existing_prefixes: phase3MutablePrefixes
    }
  };
  writeUnique(out, record);
  return record;
}
function reconcile(preflightPath, out) {
  const baseline = JSON.parse(readFileSync(preflightPath, 'utf8'));
  const failures = [];
  const mutable = [...new Set([...(baseline.path_policy?.phase3_mutable_existing_prefixes ?? []), ...phase3MutablePrefixes])];
  for (const [path, expected] of Object.entries(baseline.protected_path_hashes ?? {})) if (!mutable.some((prefix) => path.startsWith(prefix)) && fileHash(path) !== expected) failures.push(`protected path changed: ${path}`);
  if (fileHash(cargo) !== baseline.cargo_toml.content_sha256) failures.push('Cargo.toml content fingerprint changed');
  const current = new Map(inventory().map((entry) => [entry.path, entry]));
  for (const entry of baseline.untracked_inventory ?? []) {
    const now = current.get(entry.path);
    if (!now) failures.push(`initial untracked path missing: ${entry.path}`);
    else if (!mutable.some((prefix) => entry.path.startsWith(prefix)) && now.sha256 !== entry.sha256) failures.push(`initial untracked path changed: ${entry.path}`);
    current.delete(entry.path);
  }
  const allowed = [...phase3MutablePrefixes, 'src-tauri/tests/phase3_', 'artifacts/phase3/'];
  for (const path of current.keys()) if (!allowed.some((prefix) => path.startsWith(prefix))) failures.push(`unplanned new untracked path: ${path}`);
  const result = { schema_version: 1, phase: 'phase3', reconciled_at: new Date().toISOString(), preflight: rel(resolve(workspace, preflightPath)), status: failures.length ? 'fail' : 'pass', failures, cargo_toml: { content_sha256: fileHash(cargo), binary_diff_sha256: sha256(git(['diff', '--binary', '--no-ext-diff', 'HEAD', '--', cargo])) } };
  writeUnique(out, result);
  if (failures.length) throw new Error(failures.join('; '));
  return result;
}
const args = parseArgs(process.argv.slice(2));
if (!args.out || (!args.reconcile && !args.approvedPhase2 && args.approvedPhase2 !== undefined)) {
  console.error('Usage: node scripts/phase3/capture-preflight.mjs --out artifacts/phase3/<run-id>/preflight.json [--approved-phase2-manifest <path>]');
  console.error('   or: node scripts/phase3/capture-preflight.mjs --reconcile <preflight.json> --out <reconciliation.json>');
  process.exit(2);
}
const out = safeOutput(args.out);
if (args.reconcile) reconcile(resolve(workspace, args.reconcile), out);
else capture(out, args.approvedPhase2);
console.log(JSON.stringify({ status: 'pass', output: rel(out) }));
