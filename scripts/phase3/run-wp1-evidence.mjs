#!/usr/bin/env node
/* global console, process */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const workspace = resolve(import.meta.dirname, '../..');
const backend = resolve(workspace, 'src-tauri');
const artifactRoot = resolve(workspace, 'artifacts/phase3');

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function rel(path) { return relative(workspace, path).replaceAll('\\', '/'); }
function run(command, args, cwd) {
  try { return { command: [command, ...args].join(' '), cwd: rel(cwd), exit_code: 0, stdout: execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 600000 }), stderr: '' }; }
  catch (error) { return { command: [command, ...args].join(' '), cwd: rel(cwd), exit_code: error.status ?? 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? error.message ?? error) }; }
}
function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
const runId = arg('--run-id');
const preflight = arg('--preflight');
if (!runId || !preflight) { console.error('Usage: node scripts/phase3/run-wp1-evidence.mjs --run-id <id> --preflight <preflight.json>'); process.exit(2); }
const outputDir = resolve(artifactRoot, runId);
if (existsSync(outputDir)) { console.error(`Refusing artifact collision: ${outputDir}`); process.exit(2); }
mkdirSync(outputDir, { recursive: true });
const cargoPath = resolve(backend, 'Cargo.toml');
const commands = [
  run(process.execPath, [resolve(workspace, 'scripts/ipc/generate-contracts.mjs'), '--check'], workspace),
  run(process.execPath, [resolve(workspace, 'scripts/ipc/verify-handler-registry.mjs')], workspace),
  run('cargo', ['fmt', '--all', '--', '--check'], backend),
  run('cargo', ['clippy', '--locked', '--all-targets', '--', '-D', 'warnings'], backend),
  run('cargo', ['test', '--locked', '--test', 'phase3_migration', '--', '--nocapture'], backend),
  run('cargo', ['test', '--locked', '--test', 'phase3_incremental', '--', '--nocapture'], backend),
  run('cargo', ['test', '--locked', '--test', 'phase3_watcher', '--', '--nocapture'], backend),
];
const failed = commands.filter((result) => result.exit_code !== 0);
const evidence = {
  schema_version: 1,
  phase: 'phase3',
  gate: 'wp1-feasibility-and-runtime-metadata',
  run_id: runId,
  preflight: rel(resolve(workspace, preflight)),
  generated_at: new Date().toISOString(),
  status: failed.length ? 'fail' : 'pass',
  commands,
  coverage: { profiles: [1, 1000, 10000], depths: [1, 5, 8], duplicate_entry_ids_across_collections: true, malformed_tree_cases: ['cycle', 'orphan', 'duplicate-order'], composite_identity: true, watcher_real_temp_counts: [1, 100, 1000], watcher_batch_window_ms: 150, watcher_batch_max: 256, watcher_restart_overflow_fallback: true, snapshot_reconciliation: { typed_revision: true, typed_stream_id: true, typed_subscription_epoch: true, typed_sequence: true, per_collection_inflight_deduplication: true, stale_delta_rejection: true }, authoritative_source: 'collection JSON only; legacy link-index.db is not read' },
  schema: { version: 1, tables: ['collections', 'entries', 'collection_changes', 'mutation_records', 'change_feed_state', 'link_index', 'schema_migrations', 'migration_state', 'migration_backups'], foreign_keys: 'ON', journal_mode: 'WAL', checkpoint: 'TRUNCATE', sidecars: 'closed-and-absent-or-zero', retention: { mutation_records: '50,000 records per collection', collection_changes: '10,000 UI envelopes per collection' } },
  ownership: { lease: 'create_new active-lease.json', path_validation: 'exact marker-owned transaction root and backup sibling', stale_cleanup: 'never age-based; recovery/digest/ownership proof only', cross_volume: 'st_dev nearest-ancestor on Unix; conservative drive-root/unavailable behavior elsewhere' },
  canonical_boundary: { before_first_mutation: 'legacy JSON is authoritative input and remains preserved', after_first_mutation: 'metadata-v1.state + SQLite are canonical; stale JSON is never selected', rollback: 'pre-publication states roll back; post-cutover corruption returns recoverable_metadata' },
  provenance: { head_sha: run('git', ['rev-parse', 'HEAD'], workspace).stdout.trim(), git_diff_binary_sha256: sha256(execFileSync('git', ['diff', '--binary', '--no-ext-diff', 'HEAD', '--'], { cwd: workspace })), cargo_content_sha256: sha256(readFileSync(cargoPath)), cargo_binary_diff_sha256: sha256(execFileSync('git', ['diff', '--binary', '--no-ext-diff', 'HEAD', '--', 'src-tauri/Cargo.toml'], { cwd: workspace })) },
  limitations: ['SQLite canonical runtime is Phase 3 scoped; archive format and JSON backup compatibility remain unchanged.', 'Native UI/watcher timing SLOs are not claimed; Phase 0 benchmark provenance remains separate.'],
};
writeFileSync(resolve(outputDir, 'wp1-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ status: evidence.status, output: rel(resolve(outputDir, 'wp1-evidence.json')), failedCommands: failed.length }, null, 2));
if (failed.length) process.exitCode = 1;
