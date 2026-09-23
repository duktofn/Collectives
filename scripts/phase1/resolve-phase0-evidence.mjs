#!/usr/bin/env node
/* global console */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const workspaceRoot = resolve(import.meta.dirname, '../..');
const phase0Root = resolve(workspaceRoot, 'artifacts/phase0');
const phase1WritablePaths = ['src-tauri/src/collection/archive.rs', 'src-tauri/src/collection/manager.rs', 'src-tauri/src/collection/mod.rs', 'src-tauri/src/collection/model.rs', 'src-tauri/src/commands.rs', 'src-tauri/src/fs_ops.rs', 'src-tauri/src/lib.rs', 'src-tauri/src/settings.rs', 'src-tauri/src/theme_io.rs', 'src/stores/editor.ts', 'src/stores/collections.ts', 'src/components/editor/Editor.tsx', 'src/components/tree/GroupNode.tsx', 'src/components/tree/FileNode.tsx', 'src/components/tree/FolderRefNode.tsx', 'src/components/common/ZipConflictDialog.tsx', 'src/components/sidebar/CollectionItem.tsx', 'src/App.tsx', 'src/Editor.test.ts', 'src/lib/tauri.ts', 'src/types/index.ts', 'src/lib/themeEngine.ts', 'scripts/phase1/resolve-phase0-evidence.mjs', 'src-tauri/src/collection/import_transaction.rs', 'src-tauri/src/safety_error.rs', 'src-tauri/tests/phase1_safety.rs', 'src/stores/editor.phase1.test.ts', 'src/components/tree/GroupNode.phase1.test.tsx', 'src/components/common/ZipConflictDialog.phase1.test.tsx', 'src/components/sidebar/CollectionItem.phase1.test.tsx', 'src/App.phase1.test.tsx', 'src/lib/tauri.phase1.test.ts', 'docs/rebuild/phase-1-safety-report.md'];
const phase1NewPaths = phase1WritablePaths.filter((path) => !['src-tauri/src/collection/archive.rs', 'src-tauri/src/collection/manager.rs', 'src-tauri/src/collection/mod.rs', 'src-tauri/src/collection/model.rs', 'src-tauri/src/commands.rs', 'src-tauri/src/fs_ops.rs', 'src-tauri/src/lib.rs', 'src-tauri/src/settings.rs', 'src-tauri/src/theme_io.rs', 'src/stores/editor.ts', 'src/stores/collections.ts', 'src/components/editor/Editor.tsx', 'src/components/tree/GroupNode.tsx', 'src/components/tree/FileNode.tsx', 'src/components/tree/FolderRefNode.tsx', 'src/components/common/ZipConflictDialog.tsx', 'src/components/sidebar/CollectionItem.tsx', 'src/App.tsx', 'src/Editor.test.ts', 'src/lib/tauri.ts', 'src/types/index.ts', 'src/lib/themeEngine.ts'].includes(path));

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function git(args, encoding = 'utf8') { return execFileSync('git', args, { cwd: workspaceRoot, encoding }); }
function fileEvidence(path) {
  const bytes = readFileSync(path);
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
}
function findRun(runId) {
  const candidates = readdirSync(phase0Root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const candidate of candidates) {
    const directory = join(phase0Root, candidate.name);
    for (const name of ['backend.json', 'frontend.json', 'native.json', 'summary.json']) {
      const artifact = join(directory, name);
      if (existsSync(artifact)) {
        try {
          if (JSON.parse(readFileSync(artifact, 'utf8')).run_id === runId) return directory;
        } catch { /* ignore non-artifact JSON */ }
      }
    }
  }
  throw new Error(`Approved Phase 0 run-id not found by artifact metadata: ${runId}`);
}
function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--approved-manifest') args.manifest = resolve(workspaceRoot, argv[++index]);
    else if (argv[index] === '--out') args.out = resolve(workspaceRoot, argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!args.manifest || !args.out) throw new Error('Usage: node scripts/phase1/resolve-phase0-evidence.mjs --approved-manifest <path> --out <baseline-source.json>');
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(readFileSync(args.manifest, 'utf8'));
  if (manifest.schema_version !== 1 || manifest.phase !== 'phase0') throw new Error('Invalid approved Phase 0 manifest');
  const runIds = [manifest.selected_run_id, ...(manifest.coverage_run_ids ?? [])].filter(Boolean);
  const runEvidence = runIds.map((runId) => {
    const directory = findRun(runId);
    const files = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => fileEvidence(join(directory, entry.name)));
    return { run_id: runId, directory, files };
  });
  const reconciliationPath = resolve(workspaceRoot, manifest.reconciliation_path);
  const reconciliation = JSON.parse(readFileSync(reconciliationPath, 'utf8'));
  if (reconciliation.status !== 'pass' && reconciliation.result?.status !== 'pass') throw new Error('Phase 0 reconciliation is not pass');
  const cargo = fileEvidence(resolve(workspaceRoot, 'src-tauri/Cargo.toml'));
  const cargoDiff = sha256(git(['diff', '--binary', '--no-ext-diff', 'HEAD', '--', 'src-tauri/Cargo.toml'], 'buffer'));
  const output = {
    schema_version: 1,
    phase: 'phase1',
    source_manifest: fileEvidence(args.manifest),
    approved_phase0_run_ids: runIds,
    resolved_runs: runEvidence,
    reconciliation: fileEvidence(reconciliationPath),
    head_sha: git(['rev-parse', 'HEAD']).trim(),
    cargo_toml: { path: cargo.path, content_sha256: cargo.sha256, binary_diff_sha256: cargoDiff },
    cargo_file: cargo,
    initial_user_modified_paths: reconciliation.result?.baseline_initial_user_modified_paths ?? ['src-tauri/Cargo.toml'],
    untracked_inventory: [],
    path_policy: { planned_writable_paths: phase1WritablePaths, planned_new_paths: phase1NewPaths, generated_artifact_prefixes: ['artifacts/phase1/'] },
    worktree_status: git(['status', '--short']).trim().split(/\r?\n/).filter(Boolean),
    resolved_at: new Date().toISOString(),
  };
  mkdirSync(dirname(args.out), { recursive: true });
  if (existsSync(args.out)) throw new Error(`Refusing to overwrite baseline source: ${args.out}`);
  writeFileSync(args.out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status: 'pass', baseline_source: args.out, run_ids: runIds }, null, 2));
} catch (error) {
  console.error(`resolve-phase0-evidence failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
