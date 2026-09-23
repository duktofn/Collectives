#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
/* global console */
import { basename, dirname, parse, resolve } from 'node:path';
import os from 'node:os';
import process from 'node:process';

const workspaceRoot = resolve(import.meta.dirname, '../..');
const phaseRoot = resolve(workspaceRoot, 'artifacts/phase0');
const cargoPath = 'src-tauri/Cargo.toml';

const plannedWritablePaths = [
  '.github/workflows/ci.yml',
  '.github/workflows/phase0-performance.yml',
  '.gitignore',
  'package.json',
  '.nvmrc',
  'rust-toolchain.toml',
  'docs/rebuild/phase-0-baseline.md',
  'src/components/editor/Editor.tsx',
  'src/Editor.test.ts',
  'src/benchmarks/phase0-frontend.bench.ts',
  'test-fixtures/phase0/manifest.json',
  'scripts/phase0/capture-worktree.mjs',
  'scripts/phase0/generate-fixtures.mjs',
  'scripts/phase0/verify-fixtures.mjs',
  'scripts/phase0/verify-quality.mjs',
  'scripts/phase0/run-benchmarks.mjs',
  'scripts/phase0/verify-artifacts.mjs',
  'src-tauri/src/bin/phase0_bench.rs',
  'src-tauri/src/collection/archive.rs',
  'src-tauri/src/collection/manager.rs',
  'src-tauri/src/collection/mod.rs',
  'src-tauri/src/collection/model.rs',
  'src-tauri/src/commands.rs',
  'src-tauri/src/font_manager.rs',
  'src-tauri/src/fs_layer/file_identity.rs',
  'src-tauri/src/fs_layer/mod.rs',
  'src-tauri/src/fs_layer/watcher.rs',
  'src-tauri/src/fs_ops.rs',
  'src-tauri/src/lib.rs',
  'src-tauri/src/link_index.rs',
  'src-tauri/src/main.rs',
  'src-tauri/src/settings.rs',
  'src-tauri/src/theme_io.rs',
];
const plannedNewPaths = plannedWritablePaths.filter((path) =>
  ['.github/workflows/phase0-performance.yml', '.nvmrc', 'rust-toolchain.toml',
    'docs/rebuild/phase-0-baseline.md', 'src/benchmarks/phase0-frontend.bench.ts',
    'test-fixtures/phase0/manifest.json', 'scripts/phase0/capture-worktree.mjs',
    'scripts/phase0/generate-fixtures.mjs', 'scripts/phase0/verify-fixtures.mjs',
    'scripts/phase0/verify-quality.mjs', 'scripts/phase0/run-benchmarks.mjs',
    'scripts/phase0/verify-artifacts.mjs', 'src-tauri/src/bin/phase0_bench.rs'].includes(path));
const initialAllowedPaths = ['src-tauri/Cargo.toml'];

function runGit(args, options = {}) {
  return execFileSync('git', args, { cwd: workspaceRoot, encoding: options.encoding ?? 'buffer' });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function gitDiffSha(pathspec = '.') {
  return sha256(runGit(['diff', '--binary', '--no-ext-diff', 'HEAD', '--', pathspec]));
}

function tool(command, args = []) {
  if (command === 'npm') {
    const npmCli = resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    if (existsSync(npmCli)) {
      try {
        return { path: npmCli, version: execFileSync(process.execPath, [npmCli, ...args], { cwd: workspaceRoot, encoding: 'utf8' }).trim() };
      } catch {
        return { path: npmCli, version: 'unavailable' };
      }
    }
  }
  const candidates = process.platform === 'win32' && command !== 'git' ? [command, `${command}.cmd`, `${command}.exe`] : [command];
  for (const candidate of candidates) {
    try {
      return {
        path: execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [candidate], { encoding: 'utf8' }).trim().split(/\r?\n/)[0],
        version: execFileSync(candidate, args, { cwd: workspaceRoot, encoding: 'utf8' }).trim(),
      };
    } catch {
      // Try the next platform-specific executable name.
    }
  }
  return { path: null, version: 'unavailable' };
}

function listUntracked() {
  return runGit(['ls-files', '--others', '--exclude-standard', '-z'])
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((path) => {
      const absolute = resolve(workspaceRoot, path);
      const stat = statSync(absolute);
      return {
        path,
        bytes: stat.isFile() ? stat.size : null,
        sha256: stat.isFile() ? sha256(readFileSync(absolute)) : null,
        regular_file: stat.isFile(),
      };
    });
}

function pathHash(path) {
  const absolute = resolve(workspaceRoot, path);
  return existsSync(absolute) && lstatSync(absolute).isFile() ? sha256(readFileSync(absolute)) : null;
}

function assertSafeOutput(outputPath) {
  const absolute = resolve(workspaceRoot, outputPath);
  const workspace = resolve(workspaceRoot);
  const root = parse(absolute).root;
  const forbidden = [process.env.APPDATA, process.env.LOCALAPPDATA, process.env.ProgramData, process.env.TEMP, process.env.TMP]
    .filter(Boolean)
    .map((path) => resolve(path));
  if (absolute === workspace || absolute === root || forbidden.some((path) => absolute === path)) {
    throw new Error(`Refusing unsafe output path: ${absolute}`);
  }
  if (!absolute.startsWith(`${workspace}${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`Output must remain inside workspace: ${absolute}`);
  }
  return absolute;
}

function baseRecord() {
  const cargoAbsolute = resolve(workspaceRoot, cargoPath);
  const initialModifiedPaths = runGit(['diff', '--name-only', 'HEAD', '--'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
  const status = runGit(['status', '--short'], { encoding: 'utf8' }).trim();
  return {
    schema_version: 1,
    captured_at: new Date().toISOString(),
    workspace_root: workspaceRoot,
    head_sha: runGit(['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    git_status_short: status ? status.split(/\r?\n/) : [],
    git_diff_binary_sha256: gitDiffSha('.'),
    initial_user_modified_paths: initialModifiedPaths,
    path_hashes: Object.fromEntries(initialModifiedPaths.map((path) => [path, pathHash(path)])),
    untracked_inventory: listUntracked().filter((entry) => entry.regular_file),
    cargo_toml: {
      path: cargoPath,
      content_sha256: sha256(readFileSync(cargoAbsolute)),
      binary_diff_sha256: gitDiffSha(cargoPath),
    },
    tool_versions: {
      node: tool('node', ['--version']),
      npm: tool('npm', ['--version']),
      rustc: tool('rustc', ['--version']),
      cargo: tool('cargo', ['--version']),
      git: tool('git', ['--version']),
    },
    system: {
      platform: process.platform,
      os_version: `${os.type()} ${os.release()}`,
      arch: process.arch,
      cpu_model: os.cpus()[0]?.model ?? 'unknown',
      logical_cpu_count: os.cpus().length,
      total_ram_bytes: os.totalmem(),
    },
    path_policy: {
      artifacts_root: phaseRoot,
      excluded_from_recursive_cleanup: ['workspace root', 'drive roots', 'app-data roots', 'symlink/reparse roots'],
      initial_allowed_existing_modified_paths: initialAllowedPaths,
      planned_writable_paths: plannedWritablePaths,
      planned_new_paths: plannedNewPaths,
      cleanup_policy: 'The harness never recursively deletes output, fixtures, or app data.',
    },
  };
}

function writeUnique(outputPath, value) {
  const absolute = assertSafeOutput(outputPath);
  if (existsSync(absolute)) throw new Error(`Refusing to overwrite existing artifact: ${absolute}`);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return absolute;
}

function capture(outputPath) {
  const record = baseRecord();
  const unauthorized = record.initial_user_modified_paths.filter((path) => !initialAllowedPaths.includes(path) && !plannedWritablePaths.includes(path));
  if (unauthorized.length) throw new Error(`User-modified paths outside Phase 0 allowlist: ${unauthorized.join(', ')}`);
  record.run_id = basename(dirname(resolve(workspaceRoot, outputPath)));
  record.mode = 'preflight';
  record.created_artifact = writeUnique(outputPath, record);
  return { ok: true, mode: 'preflight', path: record.created_artifact, record };
}

function reconcile(preflightPath, outputPath) {
  const preflightAbsolute = assertSafeOutput(preflightPath);
  const baseline = JSON.parse(readFileSync(preflightAbsolute, 'utf8'));
  const writablePaths = new Set([...plannedWritablePaths, ...(baseline.path_policy?.planned_writable_paths ?? [])]);
  const newPaths = new Set([...plannedNewPaths, ...(baseline.path_policy?.planned_new_paths ?? [])]);
  const generatedPrefixes = baseline.path_policy?.generated_artifact_prefixes ?? [];
  const current = baseRecord();
  const failures = [];
  const currentModified = new Set(current.initial_user_modified_paths);
  for (const path of baseline.initial_user_modified_paths) {
    if (path !== cargoPath && !currentModified.has(path)) failures.push(`initial modified path disappeared from git diff: ${path}`);
    if (pathHash(path) !== (baseline.path_hashes?.[path] ?? pathHash(path))) failures.push(`initial modified content changed: ${path}`);
  }
  for (const entry of baseline.untracked_inventory) {
    const currentEntry = current.untracked_inventory.find((candidate) => candidate.path === entry.path);
    if (!currentEntry || currentEntry.sha256 !== entry.sha256) failures.push(`initial untracked file changed: ${entry.path}`);
  }
  if (current.cargo_toml.content_sha256 !== baseline.cargo_toml.content_sha256) failures.push('Cargo.toml content fingerprint changed');
  if (current.cargo_toml.binary_diff_sha256 !== baseline.cargo_toml.binary_diff_sha256) failures.push('Cargo.toml binary diff fingerprint changed');
  const initialUntracked = new Set(baseline.untracked_inventory.map((entry) => entry.path));
  for (const entry of current.untracked_inventory) {
    if (generatedPrefixes.some((prefix) => entry.path.startsWith(prefix))) continue;
    if (!initialUntracked.has(entry.path) && !newPaths.has(entry.path)) failures.push(`unplanned untracked file: ${entry.path}`);
  }
  for (const path of current.initial_user_modified_paths) {
    if (!baseline.initial_user_modified_paths.includes(path) && !writablePaths.has(path)) failures.push(`unplanned modified path: ${path}`);
  }
  const result = {
    ...current,
    mode: 'reconciliation',
    preflight_path: preflightAbsolute,
    baseline_head_sha: baseline.head_sha,
    baseline_git_diff_binary_sha256: baseline.git_diff_binary_sha256,
    baseline_initial_user_modified_paths: baseline.initial_user_modified_paths,
    failures,
    status: failures.length ? 'fail' : 'pass',
    reconciled_at: new Date().toISOString(),
  };
  const written = writeUnique(outputPath, result);
  return { ok: failures.length === 0, mode: 'reconciliation', path: written, result };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--reconcile') args.reconcile = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.out) {
    console.log('Usage: node scripts/phase0/capture-worktree.mjs --out <artifact.json> [--reconcile <preflight.json>]');
    process.exit(args.help ? 0 : 2);
  }
  const result = args.reconcile ? reconcile(args.reconcile, args.out) : capture(args.out);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.error(`capture-worktree failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
