#!/usr/bin/env node
/* global console, process */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workspace = resolve(import.meta.dirname, '../..');
const root = resolve(workspace, process.argv[2] ?? 'artifacts/phase3');
const file = process.argv.includes('--run-id') ? resolve(root, process.argv[process.argv.indexOf('--run-id') + 1], 'backend-performance.json') : resolve(root, 'backend-performance.json');
if (!existsSync(file)) { console.error(`artifact not found: ${file}`); process.exit(1); }
const artifact = JSON.parse(readFileSync(file, 'utf8'));
const failures = [];
if (artifact.status !== 'pass' || artifact.exit_code !== 0) failures.push('artifact status/exit code is not successful');
if (artifact.binary_mode !== 'release' || !String(artifact.command).includes('--release')) failures.push('canonical release provenance is missing');
if (!artifact.fixture_digest || artifact.db_pragmas?.journal_mode !== 'WAL' || artifact.db_pragmas?.connection_scope !== 'per-operation') failures.push('fixture or SQLite pragma provenance is incomplete');
const expected = new Set(['migration:1', 'migration:1000', 'migration:10000', 'incremental_mutation:10k', 'compatibility_full_save:10k', 'link_rebuild_search:50k']);
for (const workload of artifact.workloads ?? []) {
  expected.delete(`${workload.name}:${workload.profile}`);
  if (workload.sample_count !== 5 || !Array.isArray(workload.samples) || workload.samples.length !== 5 || workload.samples.some((value) => !Number.isFinite(value) || value < 0)) failures.push(`invalid raw samples: ${workload.name}/${workload.profile}`);
  for (const key of ['count', 'p50_ms', 'p95_ms', 'max_ms']) if (!Number.isFinite(workload.summary?.[key]) || workload.summary[key] < 0) failures.push(`invalid summary: ${workload.name}/${workload.profile}/${key}`);
  if (workload.name === 'incremental_mutation' && (workload.full_rebuild || workload.changed_entry_rows.some((value) => value > 4))) failures.push('v2 incremental workload reports full/large row mutation');
  if (workload.name === 'compatibility_full_save' && (!workload.full_rebuild || workload.changed_entry_rows.some((value) => value < 10000))) failures.push('full compatibility workload is not labelled/recorded as full');
}
if (expected.size) failures.push(`missing workload coverage: ${[...expected].join(', ')}`);
console.log(JSON.stringify({ status: failures.length ? 'fail' : 'pass', file, failures }, null, 2));
if (failures.length) process.exitCode = 1;
