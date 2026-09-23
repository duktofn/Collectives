#!/usr/bin/env node
/* global console */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

const workspaceRoot = resolve(import.meta.dirname, '../..');
const approvedArtifactRoot = resolve(workspaceRoot, 'artifacts/phase0');

function isWithin(candidate, parent) {
  return candidate === parent || candidate.startsWith(`${parent}${process.platform === 'win32' ? '\\' : '/'}`);
}

function assertNoSymlinkOrReparse(candidate) {
  let cursor = candidate;
  while (isWithin(cursor, approvedArtifactRoot)) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error(`Refusing symlink/reparse artifact path: ${cursor}`);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

function safeArtifactRoot(requested) {
  const candidate = resolve(workspaceRoot, requested);
  const driveRoot = parse(candidate).root;
  const appDataRoots = [process.env.APPDATA, process.env.LOCALAPPDATA, process.env.ProgramData].filter(Boolean).map((value) => resolve(value));
  if (candidate === workspaceRoot || candidate === driveRoot) throw new Error(`Refusing unsafe artifact root: ${candidate}`);
  if (!isWithin(candidate, approvedArtifactRoot)) throw new Error(`Artifact root must be approved artifacts/phase0 or a child: ${candidate}`);
  if (appDataRoots.some((root) => isWithin(candidate, root))) throw new Error(`Refusing app-data artifact root: ${candidate}`);
  assertNoSymlinkOrReparse(candidate);
  return candidate;
}

function safetySelfCheck() {
  const rejected = [workspaceRoot, parse(workspaceRoot).root, resolve(workspaceRoot, 'artifacts'), resolve(workspaceRoot, 'outside-artifacts'), ...[process.env.APPDATA, process.env.LOCALAPPDATA].filter(Boolean).map((value) => resolve(value))];
  for (const candidate of rejected) {
    let failed = false;
    try { safeArtifactRoot(candidate); } catch { failed = true; }
    if (!failed) throw new Error(`safety self-check accepted unsafe root: ${candidate}`);
  }
  const accepted = safeArtifactRoot(approvedArtifactRoot);
  return { status: 'pass', approved_root: accepted, rejected_roots: rejected, symlink_reparse_check: 'lstat chain enforced' };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function git(args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd: workspaceRoot, encoding });
}

function npmInvocation(args = []) {
  const npmCli = resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (existsSync(npmCli)) return { command: process.execPath, args: [npmCli, ...args] };
  if (process.platform !== 'win32') return { command: 'npm', args };
  throw new Error(`npm-cli.js not found at ${npmCli}; refusing shell-based npm fallback`);
}

function version(command, args) {
  const candidates = process.platform === 'win32' && command !== 'git' ? [command, command + '.cmd', command + '.exe'] : [command];
  for (const candidate of candidates) {
    try {
      if (command === 'npm') {
        const npm = npmInvocation(args);
        return execFileSync(npm.command, npm.args, { cwd: workspaceRoot, encoding: 'utf8' }).trim();
      }
      return execFileSync(candidate, args, { cwd: workspaceRoot, encoding: 'utf8' }).trim();
    } catch {
      // Try the next executable spelling.
    }
  }
  return 'unavailable';
}

function commandRun(command, args, cwd = workspaceRoot, env = process.env) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', shell: false });
  return {
    command: [command, ...args].join(' '),
    cwd,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    exit_code: result.status ?? 1,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function fixtureInfo(fixtureRoot) {
  const manifestPath = join(fixtureRoot, 'fixture-manifest.json');
  const manifestBytes = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  return { manifest, manifest_sha256: sha256(manifestBytes), content_root_sha256: manifest.content_root_sha256 };
}

function provenance(fixture, commands, collectorSource, backendInfo = {}) {
  const inventory = git(['ls-files', '--others', '--exclude-standard', '-z'], 'buffer');
  const cargo = readFileSync(resolve(workspaceRoot, 'src-tauri/Cargo.toml'));
  return {
    commit: git(['rev-parse', 'HEAD']).trim(),
    tracked_binary_diff_fingerprint: sha256(git(['diff', '--binary', '--no-ext-diff', 'HEAD', '--'], 'buffer')),
    untracked_inventory_fingerprint: sha256(inventory),
    cargo_toml_content_sha256: sha256(cargo),
    cargo_toml_binary_diff_sha256: sha256(git(['diff', '--binary', '--no-ext-diff', 'HEAD', '--', 'src-tauri/Cargo.toml'], 'buffer')),
    node: version('node', ['--version']),
    npm: version('npm', ['--version']),
    rustc: version('rustc', ['--version']),
    cargo: version('cargo', ['--version']),
    os: os.type(),
    os_version: os.release(),
    arch: process.arch,
    cpu_model: os.cpus()[0]?.model ?? 'unknown',
    logical_cpu_count: os.cpus().length,
    total_ram_bytes: os.totalmem(),
    fixture_manifest_sha256: fixture.manifest_sha256,
    generated_content_root_sha256: fixture.content_root_sha256,
    commands,
    collector_source: collectorSource,
    backend_binary_mode: backendInfo.backend_binary_mode ?? 'unknown',
    backend_binary_path: backendInfo.backend_binary_path ?? null,
    backend_binary_command: backendInfo.backend_binary_command ?? null,
    backend_canonical_release: backendInfo.backend_canonical_release ?? false,
    memory_scope: backendInfo.memory_scope ?? null,
  };
}

function backendBinaryInfo(configuredBenchBinary) {
  if (configuredBenchBinary) {
    const path = resolve(configuredBenchBinary);
    return {
      backend_binary_mode: path.includes('target\\debug') || path.includes('target/debug') ? 'debug-binary' : 'configured-binary',
      backend_binary_path: path,
      backend_binary_command: path,
      backend_canonical_release: false,
      memory_scope: 'per-child-operation',
    };
  }
  const extension = process.platform === 'win32' ? '.exe' : '';
  return {
    backend_binary_mode: 'cargo-release',
    backend_binary_path: resolve(workspaceRoot, 'src-tauri/target/release/phase0_bench' + extension),
    backend_binary_command: 'cargo run --locked --release --bin phase0_bench',
    backend_canonical_release: true,
    memory_scope: 'per-child-operation',
  };
}

function nearestRank(values, percentile) {
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.min(sorted.length, Math.ceil(percentile * sorted.length)));
  return sorted[rank - 1];
}

function summary(values) {
  if (!values.length || values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('Raw metric samples must be finite and non-negative');
  return { count: values.length, p50: nearestRank(values, 0.5), p95: nearestRank(values, 0.95), max: Math.max(...values), nearest_rank: 'rank = ceil(percentile * sample_count), 1-indexed after ascending sort' };
}

function metricSummary(samples, key) {
  return summary(samples.map((sample) => sample[key]));
}

function artifact({ runId, workload, profile, metricKind, samples, status = 'pass', exitCode = 0, error = null, fixture, commands, collectorSource, extra = {}, provenanceExtra = {} }) {
  const values = samples.map((sample) => sample.elapsed_ms);
  return {
    schema_version: 1,
    run_id: runId,
    workload,
    profile,
    metric_kind: metricKind,
    status,
    exit_code: exitCode,
    error,
    raw_samples: samples,
    summary: values.length ? summary(values) : { count: 0, p50: null, p95: null, max: null, nearest_rank: 'rank = ceil(percentile * sample_count), 1-indexed after ascending sort' },
    provenance: provenance(fixture, commands, collectorSource, provenanceExtra),
    ...extra,
  };
}

function writeJson(path, value) {
  if (existsSync(path)) throw new Error('Refusing to overwrite artifact: ' + path);
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function parseArgs(argv) {
  const args = { nativeColdSamples: 5, nativeWarmSamples: 10, workloadSamples: 5, backendOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--fixture-root') args.fixtureRoot = argv[++index];
    else if (key === '--artifact-root') args.artifactRoot = argv[++index];
    else if (key === '--native-cold-samples') args.nativeColdSamples = Number(argv[++index]);
    else if (key === '--native-warm-samples') args.nativeWarmSamples = Number(argv[++index]);
    else if (key === '--workload-samples') args.workloadSamples = Number(argv[++index]);
    else if (key === '--native-command') args.nativeCommand = argv[++index];
    else if (key === '--skip-native') args.skipNative = true;
    else if (key === '--backend-only') args.backendOnly = true;
    else if (key === '--backend-workloads') args.backendWorkloads = argv[++index].split(',').filter(Boolean);
    else if (key === '--run-id-file') args.runIdFile = argv[++index];
    else if (key === '--self-check-safety') args.selfCheckSafety = true;
    else if (key === '--help') args.help = true;
    else throw new Error('Unknown argument: ' + key);
  }
  return args;
}

function processTree(rootPid) {
  if (process.platform === 'win32') {
    const script = "$root=" + rootPid + ";$all=Get-CimInstance Win32_Process;$ids=@($root);do{$new=@($all|Where-Object{$ids -contains $_.ParentProcessId}|ForEach-Object{$_.ProcessId}|Where-Object{$ids -notcontains $_});$ids+=$new}while($new.Count -gt 0);$out=@();foreach($id in $ids){try{$p=Get-Process -Id $id -ErrorAction Stop;$out+=[pscustomobject]@{pid=$id;rss_bytes=[int64]$p.WorkingSet64;private_bytes=[int64]$p.PrivateMemorySize64}}catch{}};$out|ConvertTo-Json -Compress";
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
    if (result.status !== 0 || !result.stdout.trim()) return [];
    const value = JSON.parse(result.stdout);
    return Array.isArray(value) ? value : [value];
  }
  const result = spawnSync('ps', ['-e', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  const rows = result.stdout.trim().split(/\r?\n/).map((line) => line.trim().split(/\s+/).map(Number)).filter((row) => row.length === 3 && row.every(Number.isFinite));
  const children = new Map();
  for (const [pid, ppid, rss] of rows) children.set(pid, { pid, ppid, rss_bytes: rss * 1024, private_bytes: rss * 1024 });
  const ids = [rootPid];
  for (let index = 0; index < ids.length; index += 1) for (const row of children.values()) if (row.ppid === ids[index]) ids.push(row.pid);
  return ids.map((pid) => children.get(pid)).filter(Boolean);
}

async function waitStable(child, timeoutMs = 30000) {
  const started = Date.now();
  let stableTicks = 0;
  let peak = 0;
  let owned = [];
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error('owned process exited before reaching stable state');
    owned = processTree(child.pid);
    for (const entry of owned) peak = Math.max(peak, Number(entry.private_bytes ?? entry.rss_bytes ?? 0));
    if (owned.some((entry) => Number(entry.pid) === child.pid) && peak > 0) stableTicks += 1;
    else stableTicks = 0;
    if (stableTicks >= 2) return { elapsed_ms: Date.now() - started, peak_rss_bytes: peak, owned_process_ids: owned.map((entry) => entry.pid) };
    await sleep(250);
  }
  throw new Error('timeout waiting for owned process tree to stabilize');
}

async function terminateOwned(child) {
  const gracefulRequestedAt = new Date().toISOString();
  let gracefulMethod = process.platform === 'win32' ? 'WM_CLOSE' : 'SIGTERM';
  if (child.exitCode === null) {
    if (process.platform === 'win32') {
      const closeScript = "$p=Get-Process -Id " + child.pid + " -ErrorAction SilentlyContinue;if($p){[void]$p.CloseMainWindow()}";
      const closeResult = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', closeScript], { encoding: 'utf8' });
      if (closeResult.status !== 0) gracefulMethod = 'WM_CLOSE-request-failed';
    } else child.kill('SIGTERM');
  }
  const graceStartedAt = Date.now();
  const graceDeadline = graceStartedAt + 5000;
  while (child.exitCode === null && Date.now() < graceDeadline) await sleep(100);
  const exitedAfterGrace = child.exitCode !== null;
  let forcedCleanup = false;
  let fallbackGracefulRequestedAt = null;
  let exitedAfterFallbackGrace = false;
  if (child.exitCode === null) {
    fallbackGracefulRequestedAt = new Date().toISOString();
    if (process.platform === 'win32') {
      gracefulMethod = gracefulMethod + '+taskkill-no-force';
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T'], { encoding: 'utf8' });
    } else {
      gracefulMethod = gracefulMethod + '+SIGTERM-retry';
      child.kill('SIGTERM');
    }
    const fallbackDeadline = Date.now() + 5000;
    while (child.exitCode === null && Date.now() < fallbackDeadline) await sleep(100);
    exitedAfterFallbackGrace = child.exitCode !== null;
  }
  if (child.exitCode === null) {
    forcedCleanup = true;
    if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8' });
    else child.kill('SIGKILL');
    await sleep(500);
  }
  const remaining = processTree(child.pid);
  return {
    graceful_requested_at: gracefulRequestedAt,
    graceful_method: gracefulMethod,
    grace_wait_ms: Date.now() - graceStartedAt,
    exited_after_grace: exitedAfterGrace,
    exited_after_fallback_grace: exitedAfterFallbackGrace,
    fallback_graceful_requested_at: fallbackGracefulRequestedAt,
    exit_code: child.exitCode,
    cleanup_verified: remaining.length === 0,
    forced_cleanup: forcedCleanup,
    remaining_process_ids: remaining.map((entry) => entry.pid),
  };
}

function nativeExecutable(explicit) {
  if (explicit) return resolve(workspaceRoot, explicit);
  const extension = process.platform === 'win32' ? '.exe' : '';
  const candidates = [resolve(workspaceRoot, 'src-tauri/target/release/tauri-app' + extension), resolve(workspaceRoot, 'src-tauri/target/debug/tauri-app' + extension)];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function nativeSamples({ root, args, mode, count }) {
  const executable = nativeExecutable(args.nativeCommand);
  if (!executable) throw new Error('native executable not found; build it explicitly before running the performance harness');
  const samples = [];
  const commands = [];
  const total = mode === 'warm' ? count + 1 : count;
  for (let index = 0; index < total; index += 1) {
    const appDataRoot = join(root, 'native-app-data', mode + '-' + String(index).padStart(2, '0'));
    mkdirSync(appDataRoot, { recursive: true });
    const childEnv = { ...process.env, APPDATA: join(appDataRoot, 'roaming'), LOCALAPPDATA: join(appDataRoot, 'local'), XDG_DATA_HOME: join(appDataRoot, 'data'), XDG_CONFIG_HOME: join(appDataRoot, 'config'), XDG_CACHE_HOME: join(appDataRoot, 'cache'), COLLECTIVES_PHASE0_APP_DATA_ROOT: appDataRoot };
    for (const name of ['APPDATA', 'LOCALAPPDATA', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME']) mkdirSync(childEnv[name], { recursive: true });
    let command = executable;
    let commandArgs = [];
    if (process.platform === 'linux' && !process.env.DISPLAY) {
      const xvfb = spawnSync('which', ['xvfb-run'], { encoding: 'utf8' });
      if (xvfb.status !== 0) throw new Error('Linux native run requires DISPLAY or xvfb-run');
      command = 'xvfb-run';
      commandArgs = ['-a', executable];
    }
    const child = spawn(command, commandArgs, { cwd: workspaceRoot, env: childEnv, stdio: 'ignore', windowsHide: true });
    commands.push([command, ...commandArgs].join(' '));
    let stable;
    let cleanup;
    try {
      stable = await waitStable(child);
    } finally {
      cleanup = await terminateOwned(child);
    }
    if (!stable || !Number.isFinite(stable.elapsed_ms) || stable.elapsed_ms < 0 || !Number.isFinite(stable.peak_rss_bytes) || stable.peak_rss_bytes <= 0 || cleanup.exit_code !== 0 || !cleanup.cleanup_verified || cleanup.forced_cleanup) throw new Error('native isolation/cleanup/finite-metric contract failed for ' + mode + '-' + index + ': ' + JSON.stringify({ stable, cleanup }));
    if (!(mode === 'warm' && index === 0)) samples.push({ mode, sample_index: mode === 'warm' ? index - 1 : index, elapsed_ms: stable.elapsed_ms, peak_rss_bytes: stable.peak_rss_bytes, owned_process_ids: stable.owned_process_ids, cleanup_verified: cleanup.cleanup_verified, forced_cleanup: cleanup.forced_cleanup, remaining_process_ids: cleanup.remaining_process_ids, app_data_root: appDataRoot, grace_outcome: cleanup });
  }
  return { samples, executable, commands };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfCheckSafety) {
    console.log(JSON.stringify(safetySelfCheck(), null, 2));
    return;
  }
  if (args.help || !args.fixtureRoot || !args.artifactRoot) {
    console.log('Usage: node scripts/phase0/run-benchmarks.mjs --fixture-root <dir> --artifact-root <dir> [--native-cold-samples 5] [--native-warm-samples 10] [--workload-samples 5] [--native-command <path>]');
    return;
  }
  if ([args.nativeColdSamples, args.nativeWarmSamples, args.workloadSamples].some((value) => !Number.isInteger(value) || value <= 0)) throw new Error('sample counts must be positive integers');
  const artifactRoot = safeArtifactRoot(args.artifactRoot);
  const fixtureRoot = resolve(args.fixtureRoot);
  const fixture = fixtureInfo(fixtureRoot);
  mkdirSync(artifactRoot, { recursive: true });
  const runId = 'phase0-' + new Date().toISOString().replace(/[-:.TZ]/g, '') + '-' + git(['rev-parse', '--short', 'HEAD']).trim() + '-' + randomUUID().slice(0, 8);
  const root = join(artifactRoot, runId);
  if (existsSync(root)) throw new Error('artifact run-id collision: ' + root);
  mkdirSync(root);
  if (args.runIdFile) {
    mkdirSync(dirname(resolve(args.runIdFile)), { recursive: true });
    writeFileSync(resolve(args.runIdFile), `${runId}\n`, 'utf8');
  }
  const commands = [];
  const configuredBenchBinary = process.env.PHASE0_BENCH_BINARY ? resolve(process.env.PHASE0_BENCH_BINARY) : null;
  const backendInfo = backendBinaryInfo(configuredBenchBinary);
  const frontendSamples = [];
  for (let index = 0; !args.backendOnly && index < args.workloadSamples; index += 1) {
    const rawPath = join(root, 'frontend-vitest-' + index + '.raw');
    const command = ['run', 'phase0:frontend-bench', '--', '--outputJson', rawPath];
    const npm = npmInvocation(command);
    const result = commandRun(npm.command, npm.args);
    commands.push(result.command);
    writeFileSync(rawPath + '.stdout.txt', result.stdout + result.stderr, 'utf8');
    if (result.exit_code !== 0) throw new Error('frontend Vitest bench failed: ' + result.stderr);
    frontendSamples.push({ sample_index: index, elapsed_ms: Math.max(0, Date.parse(result.finished_at) - Date.parse(result.started_at)), peak_rss_bytes: 0, labels: ['pure-algorithm/parser', 'pure-algorithm/resolver', 'jsdom-proxy/wikilink-decoration', 'jsdom-proxy/render-decoration'] });
  }
  if (!args.backendOnly) {
    const frontendArtifact = artifact({ runId, workload: 'frontend-pure-and-jsdom-proxy', profile: fixture.manifest.profile, metricKind: 'vitest-runner-wall-ms', samples: frontendSamples, fixture, commands, collectorSource: 'scripts/phase0/run-benchmarks.mjs', provenanceExtra: backendInfo, extra: { labels: ['pure-algorithm', 'jsdom-proxy'], native_webview_claim: false } });
    frontendArtifact.contract_version = 2;
    writeJson(join(root, 'frontend.json'), frontendArtifact);
  }
  const backendPath = join(root, 'backend.json');
  const backendScratch = join(root, 'backend-scratch');
  const backendArgs = ['--fixture-root', fixtureRoot, '--scratch-root', backendScratch, '--output', backendPath, '--samples', String(args.workloadSamples), '--run-id', runId];
  if (args.backendWorkloads?.length) backendArgs.push('--workloads', args.backendWorkloads.join(','));
  const backendTool = configuredBenchBinary ?? 'cargo';
  const backendCommand = configuredBenchBinary ? backendArgs : ['run', '--locked', '--release', '--bin', 'phase0_bench', '--', ...backendArgs];
  const backendResult = commandRun(backendTool, backendCommand, configuredBenchBinary ? workspaceRoot : resolve(workspaceRoot, 'src-tauri'));
  commands.push(backendResult.command);
  if (backendResult.exit_code !== 0) throw new Error('backend benchmark failed: ' + backendResult.stderr);
  const backendArtifact = JSON.parse(readFileSync(backendPath, 'utf8'));
  backendArtifact.contract_version = 2;
  backendArtifact.coverage = { mode: args.backendOnly ? 'backend-coverage' : 'full-matrix', profile: fixture.manifest.profile, workload_names: backendArtifact.workloads.map((workload) => workload.workload), profile_definition: fixture.manifest.profile_definition, required: { collection_entries: fixture.manifest.profile_definition.collection_entries, index_entries: fixture.manifest.profile_definition.index_entries, trusted_zip_collection_entries: backendArtifact.workloads.some((workload) => workload.workload === 'trusted-zip-export-import') ? fixture.manifest.profile_definition.collection_entries : null } };
  backendArtifact.provenance = { ...provenance(fixture, commands, 'scripts/phase0/run-benchmarks.mjs + src-tauri/src/bin/phase0_bench.rs', backendInfo), memory_method: backendArtifact.provenance?.memory_method ?? null, memory_scope: backendArtifact.provenance?.memory_scope ?? 'per-child-operation' };
  backendArtifact.commands = commands;
  writeFileSync(backendPath, JSON.stringify(backendArtifact, null, 2) + '\n', 'utf8');
  let nativeArtifact;
  if (args.backendOnly) {
    nativeArtifact = null;
  } else if (args.skipNative) {
    nativeArtifact = artifact({ runId, workload: 'native-tauri-startup-memory', profile: fixture.manifest.profile, metricKind: 'launch-to-stable-ms+peak-private-memory-bytes', samples: [], status: 'blocked', exitCode: 2, error: 'native harness explicitly skipped', fixture, commands, collectorSource: 'scripts/phase0/run-benchmarks.mjs', provenanceExtra: backendInfo, extra: { isolation_required: true, cleanup_required: true } });
  } else {
    const cold = await nativeSamples({ root, args, mode: 'cold', count: args.nativeColdSamples });
    const warm = await nativeSamples({ root, args, mode: 'warm', count: args.nativeWarmSamples });
    nativeArtifact = artifact({ runId, workload: 'native-tauri-startup-memory', profile: fixture.manifest.profile, metricKind: 'launch-to-stable-ms+peak-private-memory-bytes', samples: [...cold.samples, ...warm.samples], fixture, commands: [...commands, ...cold.commands, ...warm.commands], collectorSource: 'scripts/phase0/run-benchmarks.mjs', provenanceExtra: backendInfo, extra: { cold_samples: cold.samples, warm_samples: warm.samples, cold_summary: { elapsed_ms: metricSummary(cold.samples, 'elapsed_ms'), peak_rss_bytes: metricSummary(cold.samples, 'peak_rss_bytes') }, warm_summary: { elapsed_ms: metricSummary(warm.samples, 'elapsed_ms'), peak_rss_bytes: metricSummary(warm.samples, 'peak_rss_bytes') }, isolation: 'child-only APPDATA/LOCALAPPDATA/XDG_* roots', cleanup_evidence: 'every sample waits after WM_CLOSE/taskkill graceful request; forced owned-tree cleanup fails the run' } });
  }
  if (!args.backendOnly) {
    nativeArtifact.contract_version = 2;
    writeJson(join(root, 'native.json'), nativeArtifact);
    const summaryArtifact = artifact({ runId, workload: 'phase0-summary', profile: fixture.manifest.profile, metricKind: 'status-only', samples: [{ elapsed_ms: 0, peak_rss_bytes: 1 }], fixture, commands, collectorSource: 'scripts/phase0/run-benchmarks.mjs', provenanceExtra: backendInfo, extra: { artifacts: ['frontend.json', 'backend.json', 'native.json'], timings_informational: true, no_slo_threshold: true } });
    summaryArtifact.contract_version = 2;
    writeJson(join(root, 'summary.json'), summaryArtifact);
  }
  console.log(JSON.stringify({ status: 'pass', run_id: runId, artifact_root: root, fixture_manifest_sha256: fixture.manifest_sha256, content_root_sha256: fixture.content_root_sha256 }, null, 2));
}

run().catch((error) => {
  console.error('run-benchmarks failed: ' + (error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exitCode = 1;
});
