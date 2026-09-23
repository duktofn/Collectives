#!/usr/bin/env node
/* global console */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';

const workspaceRoot = resolve(import.meta.dirname, '../..');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root') args.root = resolve(workspaceRoot, argv[++index]);
    else if (argv[index] === '--run-id') args.run_id = argv[++index];
    else if (argv[index] === '--coverage-run-id') (args.coverage_run_ids ??= []).push(argv[++index]);
    else if (argv[index] === '--allow-incomplete') args.allow_incomplete = true;
    else if (argv[index] === '--require-release') args.require_release = true;
    else throw new Error('Unknown argument: ' + argv[index]);
  }
  if (!args.root) throw new Error('Usage: node scripts/phase0/verify-artifacts.mjs --root artifacts/phase0 [--run-id <complete-run-id>]');
  return args;
}

function jsonFiles(root) {
  const result = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory() && !['backend-scratch', 'native-app-data'].includes(entry.name)) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.json')) result.push(absolute);
    }
  }
  visit(root);
  return result;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function expectedRank(samples, percentile) {
  const values = samples.map((sample) => sample.elapsed_ms).sort((left, right) => left - right);
  if (!values.length) return null;
  return values[Math.max(0, Math.min(values.length - 1, Math.ceil(percentile * values.length) - 1))];
}

function verifySummary(artifact, path) {
  const samples = artifact.raw_samples;
  const summary = artifact.summary;
  if (!summary || summary.count !== samples.length) throw new Error('summary count mismatch: ' + path);
  if (samples.length && (summary.p50 !== expectedRank(samples, 0.5) || summary.p95 !== expectedRank(samples, 0.95) || summary.max !== Math.max(...samples.map((sample) => sample.elapsed_ms)))) throw new Error('summary raw-to-summary mismatch: ' + path);
  if (samples.length && (!finite(summary.p50) || !finite(summary.p95) || !finite(summary.max))) throw new Error('summary has non-finite values: ' + path);
}

function verifyMetricSummary(samples, summary, field, path) {
  if (!summary || summary.count !== samples.length) throw new Error(field + ' summary count mismatch: ' + path);
  const values = samples.map((sample) => sample[field]);
  if (values.some((value) => !finite(value))) throw new Error(field + ' sample is not finite/non-negative: ' + path);
  const sorted = [...values].sort((left, right) => left - right);
  const rank = (percentile) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(percentile * sorted.length) - 1))];
  if (summary.p50 !== rank(0.5) || summary.p95 !== rank(0.95) || summary.max !== Math.max(...values)) throw new Error(field + ' raw-to-summary mismatch: ' + path);
}

function verifyArtifact(path, runIds) {
  const artifact = JSON.parse(readFileSync(path, 'utf8'));
  if (artifact.mode === 'preflight' || artifact.mode === 'reconciliation') return { kind: artifact.mode, path };
  if (artifact.kind === 'quality-log') return { kind: 'quality-log', path };
  if (![2, 3].includes(artifact.contract_version) || artifact.provenance?.memory_scope !== 'per-child-operation') return { kind: 'legacy-artifact', path, status: 'legacy' };
  const required = ['schema_version', 'run_id', 'workload', 'profile', 'metric_kind', 'status', 'exit_code', 'error', 'raw_samples', 'summary', 'provenance'];
  for (const field of required) if (!(field in artifact)) throw new Error('missing schema field ' + field + ': ' + path);
  if (artifact.schema_version !== 1 || typeof artifact.run_id !== 'string' || !artifact.run_id) throw new Error('invalid artifact identity: ' + path);
  const runRoot = resolve(path, '..');
  if (runIds.has(runRoot) && runIds.get(runRoot) !== artifact.run_id) throw new Error('run-id mismatch within artifact directory: ' + path);
  runIds.set(runRoot, artifact.run_id);
  if (!Array.isArray(artifact.raw_samples)) throw new Error('raw_samples must be an array: ' + path);
  for (const sample of artifact.raw_samples) {
    if (!finite(sample.elapsed_ms)) throw new Error('raw elapsed_ms is not finite/non-negative: ' + path);
    if ('peak_rss_bytes' in sample && (!finite(sample.peak_rss_bytes) || (artifact.workload === 'native-tauri-startup-memory' && sample.peak_rss_bytes <= 0))) throw new Error('raw memory metric invalid: ' + path);
  }
  verifySummary(artifact, path);
  const requiredProvenance = ['commit', 'tracked_binary_diff_fingerprint', 'untracked_inventory_fingerprint', 'cargo_toml_content_sha256', 'cargo_toml_binary_diff_sha256', 'fixture_manifest_sha256', 'generated_content_root_sha256', 'collector_source', 'backend_binary_mode', 'backend_binary_path', 'backend_binary_command', 'backend_canonical_release', 'memory_scope'];
  for (const field of requiredProvenance) if (!(field in artifact.provenance)) throw new Error('missing provenance field ' + field + ': ' + path);
  if (artifact.status === 'pass' && artifact.exit_code !== 0) throw new Error('pass artifact has non-zero exit code: ' + path);
  if (artifact.status === 'pass' && artifact.raw_samples.length === 0) throw new Error('pass artifact has no raw samples: ' + path);
  if (artifact.workload === 'native-tauri-startup-memory' && artifact.status === 'pass') {
    const cold = artifact.raw_samples.filter((sample) => sample.mode === 'cold');
    const warm = artifact.raw_samples.filter((sample) => sample.mode === 'warm');
    if (cold.length !== 5 || warm.length !== 10) throw new Error('native requires exactly 5 cold and 10 warm samples: ' + path);
    verifyMetricSummary(cold, artifact.cold_summary?.elapsed_ms, 'elapsed_ms', path);
    verifyMetricSummary(cold, artifact.cold_summary?.peak_rss_bytes, 'peak_rss_bytes', path);
    verifyMetricSummary(warm, artifact.warm_summary?.elapsed_ms, 'elapsed_ms', path);
    verifyMetricSummary(warm, artifact.warm_summary?.peak_rss_bytes, 'peak_rss_bytes', path);
    for (const sample of artifact.raw_samples) {
      if (sample.cleanup_verified !== true || sample.forced_cleanup === true || sample.grace_outcome?.forced_cleanup === true || sample.grace_outcome?.exit_code !== 0 || (!sample.grace_outcome?.exited_after_grace && !sample.grace_outcome?.exited_after_fallback_grace) || (sample.remaining_process_ids ?? []).length !== 0) throw new Error('native cleanup evidence failed: ' + path);
      if (!sample.app_data_root || !resolve(sample.app_data_root).startsWith(runRoot)) throw new Error('native app-data root is not child-isolated: ' + path);
    }
  }
  if (artifact.workload === 'backend-matrix' && artifact.status === 'pass') {
    if (artifact.provenance.memory_scope !== 'per-child-operation') throw new Error('backend memory scope is not per-child-operation: ' + path);
    const expectedWorkloads = ['collection-json-load-mutation', 'sqlite-link-index-rebuild-search', 'temporary-file-read-write', 'trusted-zip-export-import'];
    const names = Array.isArray(artifact.workloads) ? artifact.workloads.map((workload) => workload.workload) : [];
    const isCoverage = artifact.coverage?.mode === 'backend-coverage';
    if (!Array.isArray(artifact.workloads) || (!isCoverage && names.join('|') !== expectedWorkloads.join('|')) || (isCoverage && names.length === 0)) throw new Error('backend workload names/coverage mismatch: ' + path);
    if (artifact.coverage?.profile !== artifact.profile || !artifact.coverage?.profile_definition || !artifact.coverage?.required) throw new Error('backend coverage declaration missing: ' + path);
    for (const workload of artifact.workloads) {
      if (!Array.isArray(workload.samples) || workload.samples.length === 0) throw new Error('backend workload has no samples: ' + path);
      verifyMetricSummary(workload.samples, workload.elapsed_summary, 'elapsed_ms', path);
      verifyMetricSummary(workload.samples, workload.peak_rss_summary, 'peak_rss_bytes', path);
    }
  }
  return { kind: artifact.workload, path, run_id: artifact.run_id, status: artifact.status, explicit_skip: artifact.status === 'blocked' && artifact.error === 'native harness explicitly skipped' };
}

function classifyRuns(root) {
  const expected = ['frontend.json', 'backend.json', 'native.json', 'summary.json'];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('phase0-'))
    .map((entry) => {
      const directory = join(root, entry.name);
      const names = new Set(readdirSync(directory, { withFileTypes: true }).filter((child) => child.isFile()).map((child) => child.name));
      if (!expected.some((name) => names.has(name))) return null;
      const missing = expected.filter((name) => !names.has(name));
      let classification = missing.length ? 'incomplete' : 'complete';
      if (classification === 'complete') {
        for (const name of expected) {
          try {
            const candidate = JSON.parse(readFileSync(join(directory, name), 'utf8'));
            if (![2, 3].includes(candidate.contract_version) || candidate.provenance?.memory_scope !== 'per-child-operation') classification = 'legacy';
          } catch {
            classification = 'legacy';
          }
        }
      }
      return { run_id: entry.name, path: directory, classification, missing_artifacts: missing };
    })
    .filter(Boolean);
}

function verifyCompleteSelection(run, jsonResults, requireRelease = false) {
  if (!run) return;
  if (run.classification !== 'complete') throw new Error('Selected run-id is not a complete matrix: ' + run.run_id);
  const files = ['frontend.json', 'backend.json', 'native.json', 'summary.json'].map((name) => join(run.path, name));
  const artifacts = files.map((path) => JSON.parse(readFileSync(path, 'utf8')));
  if (artifacts.some((artifact) => artifact.status !== 'pass' || artifact.exit_code !== 0)) throw new Error('Selected complete matrix contains a failed/blocked artifact: ' + run.run_id);
  const frontend = artifacts.find((artifact) => artifact.workload === 'frontend-pure-and-jsdom-proxy');
  const backend = artifacts.find((artifact) => artifact.workload === 'backend-matrix');
  const native = artifacts.find((artifact) => artifact.workload === 'native-tauri-startup-memory');
  if (!frontend || frontend.raw_samples.length < 5) throw new Error('Selected run lacks five frontend samples: ' + run.run_id);
  if (!backend || !Array.isArray(backend.workloads) || backend.workloads.some((workload) => workload.samples.length < 5)) throw new Error('Selected run lacks five backend samples per workload: ' + run.run_id);
  if (backend.coverage?.mode !== 'full-matrix' || backend.coverage.workload_names?.length !== 4) throw new Error('Selected run lacks full backend workload coverage declaration: ' + run.run_id);
  if (!native || native.raw_samples.length < 15) throw new Error('Selected run lacks five cold plus ten warm native samples: ' + run.run_id);
  if (requireRelease && backend.provenance?.backend_binary_mode !== 'cargo-release') throw new Error('Selected run is not canonical cargo-release evidence: ' + run.run_id);
  if (jsonResults.some((result) => result.path.startsWith(run.path) && result.status === 'fail')) throw new Error('Selected run has a schema/status failure: ' + run.run_id);
}

function verifyCoverageSelection(run, jsonResults, requireRelease = false) {
  if (!run) return;
  const backendPath = join(run.path, 'backend.json');
  if (!existsSync(backendPath)) throw new Error('Selected coverage run has no backend artifact: ' + run.run_id);
  const backend = JSON.parse(readFileSync(backendPath, 'utf8'));
  if (![2, 3].includes(backend.contract_version) || backend.status !== 'pass' || backend.coverage?.mode !== 'backend-coverage') throw new Error('Selected coverage run is not a Phase 0 backend-coverage artifact: ' + run.run_id);
  if (requireRelease && backend.provenance?.backend_binary_mode !== 'cargo-release') throw new Error('Selected coverage run is not canonical cargo-release evidence: ' + run.run_id);
  const names = backend.workloads?.map((workload) => workload.workload) ?? [];
  for (const workload of backend.workloads) if (workload.samples.length < 5) throw new Error('Selected coverage workload has fewer than five samples: ' + workload.workload);
  const definition = backend.coverage.profile_definition;
  if (backend.profile === 'smoke' && (!names.includes('sqlite-link-index-rebuild-search') || !names.includes('temporary-file-read-write') || definition.index_entries !== 10000 || definition.io_bytes !== 10240)) throw new Error('Selected smoke coverage does not prove index 10k and I/O 10KB: ' + run.run_id);
  if (backend.profile === 'large' && (!names.includes('collection-json-load-mutation') || !names.includes('sqlite-link-index-rebuild-search') || !names.includes('temporary-file-read-write') || definition.collection_entries !== 10000 || definition.index_entries !== 50000 || definition.io_bytes !== 10485760)) throw new Error('Selected large coverage does not prove collection 10k, index 50k, and I/O 10MB: ' + run.run_id);
  if (jsonResults.some((result) => result.path.startsWith(run.path) && result.status === 'fail')) throw new Error('Selected coverage run has a schema/status failure: ' + run.run_id);
}

function verifyCoverageMatrix(completeRun, coverageRuns) {
  const backends = [];
  if (completeRun) backends.push(JSON.parse(readFileSync(join(completeRun.path, 'backend.json'), 'utf8')));
  for (const run of coverageRuns) backends.push(JSON.parse(readFileSync(join(run.path, 'backend.json'), 'utf8')));
  const values = { collection: new Set(), index: new Set(), io: new Set(), archive: new Set() };
  for (const backend of backends) {
    const definition = backend.coverage?.profile_definition;
    for (const workload of backend.coverage?.workload_names ?? []) {
      if (workload === 'collection-json-load-mutation') values.collection.add(definition.collection_entries);
      if (workload === 'sqlite-link-index-rebuild-search') values.index.add(definition.index_entries);
      if (workload === 'temporary-file-read-write') values.io.add(definition.io_bytes);
      if (workload === 'trusted-zip-export-import') values.archive.add(definition.collection_entries);
    }
  }
  const required = { collection: [1000, 10000], index: [10000, 50000], io: [10240, 1048576, 10485760], archive: [1000] };
  for (const [dimension, expected] of Object.entries(required)) for (const value of expected) if (!values[dimension].has(value)) throw new Error(`selected coverage matrix missing ${dimension}=${value}`);
  return { required, observed: Object.fromEntries(Object.entries(values).map(([key, set]) => [key, [...set].sort((left, right) => left - right)])) };
}

try {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root;
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error('artifact root is not a directory: ' + root);
  const files = jsonFiles(root);
  const runIds = new Map();
  const results = files.map((path) => verifyArtifact(path, runIds));
  const failures = results.filter((result) => result.status === 'fail' || (result.status === 'blocked' && !result.explicit_skip));
  if (failures.length) throw new Error('artifact status failure: ' + failures.map((result) => result.path).join(', '));
  const classifications = classifyRuns(root);
  const selection = args.run_id ? classifications.find((candidate) => candidate.run_id === args.run_id) ?? { run_id: args.run_id, classification: 'missing' } : null;
  verifyCompleteSelection(selection, results, args.require_release);
  const coverageSelections = (args.coverage_run_ids ?? []).map((coverageRunId) => classifications.find((candidate) => candidate.run_id === coverageRunId) ?? { run_id: coverageRunId, path: join(root, coverageRunId), classification: 'missing' });
  for (const coverageRun of coverageSelections) verifyCoverageSelection(coverageRun, results, args.require_release);
  const coverageMatrix = selection || coverageSelections.length ? verifyCoverageMatrix(selection, coverageSelections) : null;
  const complete = classifications.filter((candidate) => candidate.classification === 'complete');
  if (args.require_release) {
    for (const candidate of complete) {
      const backendPath = join(candidate.path, 'backend.json');
      if (existsSync(backendPath) && JSON.parse(readFileSync(backendPath, 'utf8')).provenance?.backend_binary_mode !== 'cargo-release') throw new Error('Complete run is not canonical cargo-release evidence: ' + candidate.run_id);
    }
  }
  if (args.run_id === undefined && complete.length === 0 && !args.allow_incomplete) throw new Error('No complete benchmark matrix found; incomplete runs are preserved and classified, not silently accepted');
  console.log(JSON.stringify({ status: 'pass', root, json_artifacts: results.length, benchmark_runs: classifications.length, complete_runs: complete.map((candidate) => candidate.run_id), incomplete_runs: classifications.filter((candidate) => candidate.classification === 'incomplete').map((candidate) => ({ run_id: candidate.run_id, missing_artifacts: candidate.missing_artifacts })), legacy_runs: classifications.filter((candidate) => candidate.classification === 'legacy').map((candidate) => candidate.run_id), selected_run_id: args.run_id ?? null, selected_coverage_run_ids: args.coverage_run_ids ?? [], coverage_matrix: coverageMatrix, checked_paths: results.map((result) => relative(root, result.path)) }, null, 2));
} catch (error) {
  console.error('verify-artifacts failed: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
