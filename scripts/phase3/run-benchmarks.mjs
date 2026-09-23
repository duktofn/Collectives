#!/usr/bin/env node
/* global console, process */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parse, relative, resolve } from 'node:path';

const workspace = resolve(import.meta.dirname, '../..');
const backend = resolve(workspace, 'src-tauri');
const defaultRoot = resolve(workspace, 'artifacts/phase3');
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function rel(path) { return relative(workspace, path).replaceAll('\\', '/'); }
function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function safeArtifactRoot(value) {
  const root = resolve(workspace, value ?? 'artifacts/phase3');
  const workspacePrefix = `${workspace}${process.platform === 'win32' ? '\\' : '/'}`;
  const forbidden = [process.env.APPDATA, process.env.LOCALAPPDATA, process.env.ProgramData, process.env.TEMP, process.env.TMP].filter(Boolean).map((item) => resolve(item));
  if (root === workspace || root === parse(root).root || !root.startsWith(workspacePrefix) || forbidden.some((item) => root === item) || (existsSync(root) && lstatSync(root).isSymbolicLink())) throw new Error(`unsafe Phase 3 artifact root: ${root}`);
  if (root !== defaultRoot && !root.startsWith(`${defaultRoot}${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error('Phase 3 benchmark artifacts must remain under artifacts/phase3');
  return root;
}
const root = safeArtifactRoot(arg('--artifact-root'));
const runId = arg('--run-id') ?? `phase3-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${process.pid}`;
const outputDir = resolve(root, runId);
if (existsSync(outputDir)) throw new Error(`refusing artifact collision: ${outputDir}`);
mkdirSync(outputDir, { recursive: true });
const command = ['run', '--locked', '--release', '--bin', 'phase3_bench'];
let status = 'pass'; let stdout = ''; let error = null;
try { stdout = execFileSync('cargo', command, { cwd: backend, encoding: 'utf8', timeout: 1_800_000 }); }
catch (cause) { status = 'fail'; error = String(cause?.stderr ?? cause?.message ?? cause); stdout = String(cause?.stdout ?? ''); }
writeFileSync(resolve(outputDir, 'phase3-bench-stdout.txt'), stdout, { flag: 'wx' });
let bench = null;
if (status === 'pass') { try { const jsonStart = stdout.indexOf('{'); if (jsonStart < 0) throw new Error('benchmark JSON object not found'); bench = JSON.parse(stdout.slice(jsonStart)); } catch (cause) { status = 'fail'; error = `benchmark JSON parse failed: ${cause}`; } }
const record = { schema_version: 1, phase: 'phase3', run_id: runId, status, exit_code: status === 'pass' ? 0 : 1, command: `cargo ${command.join(' ')}`, binary_mode: bench?.mode ?? 'unknown', binary_path: `target/release/phase3_bench${process.platform === 'win32' ? '.exe' : ''}`, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim(), tracked_binary_diff_sha256: sha256(execFileSync('git', ['diff', '--binary', '--no-ext-diff', 'HEAD', '--'], { cwd: workspace })), cargo_toml_content_sha256: sha256(readFileSync(resolve(backend, 'Cargo.toml'))), fixture_digest: bench?.fixture_digest ?? null, db_pragmas: bench?.db_pragmas ?? null, workloads: bench?.workloads ?? [], error, provenance: { node: process.version, rustc: execFileSync('rustc', ['--version'], { cwd: workspace, encoding: 'utf8' }).trim(), cargo: execFileSync('cargo', ['--version'], { cwd: workspace, encoding: 'utf8' }).trim(), output: rel(outputDir) } };
writeFileSync(resolve(outputDir, 'backend-performance.json'), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ status, run_id: runId, output: rel(resolve(outputDir, 'backend-performance.json')) }, null, 2));
if (status !== 'pass') process.exitCode = 1;
