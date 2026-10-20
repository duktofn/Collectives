#!/usr/bin/env node
/* global console, document, fetch, performance, requestAnimationFrame, window */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { createServer } from 'node:net';
import os from 'node:os';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from '@playwright/test';

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
  const args = { nativeColdSamples: 5, nativeWarmSamples: 10, nativeUiSamples: 5, nativeTypingSamples: 20, workloadSamples: 5, backendOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--fixture-root') args.fixtureRoot = argv[++index];
    else if (key === '--artifact-root') args.artifactRoot = argv[++index];
    else if (key === '--native-cold-samples') args.nativeColdSamples = Number(argv[++index]);
    else if (key === '--native-warm-samples') args.nativeWarmSamples = Number(argv[++index]);
    else if (key === '--workload-samples') args.workloadSamples = Number(argv[++index]);
    else if (key === '--native-ui-samples') args.nativeUiSamples = Number(argv[++index]);
    else if (key === '--native-typing-samples') args.nativeTypingSamples = Number(argv[++index]);
    else if (key === '--native-smoke-fixture-root') args.nativeSmokeFixtureRoot = argv[++index];
    else if (key === '--native-large-fixture-root') args.nativeLargeFixtureRoot = argv[++index];
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
  let remaining = processTree(child.pid);
  const descendantGraceDeadline = Date.now() + 5000;
  while (remaining.length > 0 && Date.now() < descendantGraceDeadline) {
    await sleep(150);
    remaining = processTree(child.pid);
  }
  if (remaining.length > 0 && process.platform === 'win32') {
    gracefulMethod += '+orphaned-webview-taskkill-no-force';
    fallbackGracefulRequestedAt ??= new Date().toISOString();
    for (const processInfo of remaining) {
      if (Number(processInfo.pid) !== child.pid) spawnSync('taskkill.exe', ['/PID', String(processInfo.pid), '/T'], { encoding: 'utf8' });
    }
    const descendantFallbackDeadline = Date.now() + 5000;
    while (remaining.length > 0 && Date.now() < descendantFallbackDeadline) {
      await sleep(150);
      remaining = processTree(child.pid);
    }
  }
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
  const release = resolve(workspaceRoot, 'src-tauri/target/release/tauri-app' + extension);
  return existsSync(release) ? release : null;
}

function generatedAppIdentifier(runId, sessionIndex) {
  const digits = runId.replace(/\D/g, '').slice(0, 24) || Date.now().toString();
  return `com.collectives.phase0.p${digits}.s${sessionIndex}`;
}

function validateAppIdentifier(identifier) {
  if (!/^[a-zA-Z][a-zA-Z0-9-]*(\.[a-zA-Z][a-zA-Z0-9-]*){2,}$/.test(identifier)) {
    throw new Error('Native app identifier must be a reverse-domain identifier with alphanumeric labels.');
  }
}

function buildNativeRelease(root, identifier, sessionName) {
  const overlayPath = join(os.tmpdir(), `collectives-phase0-${randomUUID()}.json`);
  writeFileSync(overlayPath, JSON.stringify({ identifier }), { encoding: 'utf8', flag: 'wx' });
  try {
    const npm = npmInvocation(['run', 'tauri', '--', 'build', '--no-bundle', '--config', overlayPath]);
    const result = commandRun(npm.command, npm.args);
    writeFileSync(join(root, `${sessionName}-native-build.log.txt`), result.stdout + result.stderr, 'utf8');
    if (result.exit_code !== 0) throw new Error(`Windows native release build failed (${result.exit_code}). See ${sessionName}-native-build.log.txt.`);
    const executable = nativeExecutable(null);
    if (!executable) throw new Error('Tauri release build succeeded but src-tauri/target/release/tauri-app.exe is missing.');
    return { executable, command: result.command, started_at: result.started_at, finished_at: result.finished_at, app_identifier: identifier };
  } finally {
    rmSync(overlayPath, { force: true });
  }
}

function rebaseCollectionPaths(entries, base) {
  for (const entry of entries) {
    if (entry.type === 'group') rebaseCollectionPaths(entry.children, base);
    else entry.path = resolve(base, entry.path);
  }
}

function readFixtureCollection(fixtureRoot) {
  const path = join(fixtureRoot, 'collection/collection.json');
  const value = JSON.parse(readFileSync(path, 'utf8'));
  rebaseCollectionPaths(value.entries, fixtureRoot);
  return value;
}

function seedNativeAppData({ appDataRoot, fixtureRoots }) {
  const collectionRoot = join(appDataRoot, '.collections');
  mkdirSync(collectionRoot, { recursive: true });
  const collections = [];
  for (const profile of ['smoke', 'standard', 'large']) {
    const fixtureRoot = fixtureRoots[profile];
    const manifest = fixtureInfo(fixtureRoot).manifest;
    if (manifest.profile !== profile) throw new Error(`Expected ${profile} fixture at ${fixtureRoot}, found ${manifest.profile}`);
    const collection = readFixtureCollection(fixtureRoot);
    writeFileSync(join(collectionRoot, `${collection.id}.json`), `${JSON.stringify(collection, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    collections.push(collection);
  }

  const smokeRoot = fixtureRoots.smoke;
  const nativeSource = join(smokeRoot, 'native');
  const nativeRoot = join(appDataRoot, 'native');
  if (!existsSync(join(smokeRoot, 'fixture-manifest.json')) || !existsSync(nativeSource)) {
    throw new Error('The smoke fixture must contain deterministic native workload data. Regenerate it with the updated fixture generator.');
  }
  cpSync(nativeSource, nativeRoot, { recursive: true, errorOnExist: true, force: false });

  for (const filename of [
    'search-100.json',
    'search-2000.json',
    'typing-100k-collection.json',
    'typing-1m-collection.json',
    'ui-collection.json',
  ]) {
    const source = JSON.parse(readFileSync(join(nativeRoot, filename), 'utf8'));
    rebaseCollectionPaths(source.entries, appDataRoot);
    writeFileSync(join(collectionRoot, `${source.id}.json`), `${JSON.stringify(source, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    collections.push(source);
  }
  const emptyCollection = {
    id: 'phase0-native-empty',
    schemaVersion: 1,
    name: 'Phase 0 Empty',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    entries: [],
    metadata: null,
  };
  writeFileSync(join(collectionRoot, `${emptyCollection.id}.json`), `${JSON.stringify(emptyCollection, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  collections.push(emptyCollection);
  return { collection_count: collections.length, collection_entry_counts: Object.fromEntries(collections.map((collection) => [collection.id, collection.entries.length])), native_fixture_root: nativeRoot };
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const { port } = server.address();
  await new Promise((resolvePromise, reject) => server.close((error) => (error ? reject(error) : resolvePromise())));
  return port;
}

async function waitForNativePage(child, port, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let endpoint = false;
  while (Date.now() < deadline && !endpoint) {
    if (child.exitCode !== null) throw new Error(`Native app exited with ${child.exitCode} before WebView startup.`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      endpoint = response.ok;
    } catch {
      await sleep(200);
    }
  }
  if (!endpoint) throw new Error('Timed out waiting for the native WebView2 debugging endpoint.');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const pageDeadline = Date.now() + timeoutMs;
    let page = null;
    while (Date.now() < pageDeadline && !page) {
      page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().startsWith('http://tauri.localhost/')) ?? null;
      if (!page) await sleep(100);
    }
    if (!page) throw new Error('WebView2 connected but did not expose the Tauri application page.');
    await page.waitForFunction(() => document.readyState === 'complete' && Boolean(document.body?.innerText.trim()), null, { timeout: timeoutMs });
    return { browser, page };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

function summarizeProcessWindow(rows, startEpochMs, endEpochMs) {
  const valid = rows.filter((row) => Number.isFinite(row.timestamp_epoch_ms) && Number.isFinite(row.rss_bytes) && Number.isFinite(row.cpu_seconds));
  const before = [...valid].reverse().find((row) => row.timestamp_epoch_ms <= startEpochMs) ?? valid[0];
  const after = valid.find((row) => row.timestamp_epoch_ms >= endEpochMs) ?? valid.at(-1);
  const windowRows = valid.filter((row) => row.timestamp_epoch_ms >= startEpochMs && row.timestamp_epoch_ms <= endEpochMs);
  if (!before || !after) throw new Error('Native process monitor did not capture a complete metric window.');
  const observed = windowRows.length ? windowRows : [before, after];
  const processCpu = new Map();
  for (const row of observed) {
    for (const processInfo of row.processes ?? []) {
      if (!Number.isFinite(processInfo.pid) || !Number.isFinite(processInfo.cpu_seconds)) continue;
      if (!processCpu.has(processInfo.pid)) processCpu.set(processInfo.pid, []);
      processCpu.get(processInfo.pid).push(processInfo.cpu_seconds);
    }
  }
  const sampledCpuDelta = [...processCpu.values()].reduce((total, readings) => {
    if (readings.length < 2) return total;
    return total + Math.max(0, Math.max(...readings) - Math.min(...readings));
  }, 0);
  const aggregateDelta = Math.max(0, after.cpu_seconds - before.cpu_seconds);
  return {
    cpu_seconds: Math.max(sampledCpuDelta, aggregateDelta),
    cpu_seconds_method: 'process-tree per-PID cumulative CPU delta sampled by PowerShell; aggregate fallback includes surviving process tree',
    rss_start_bytes: before.rss_bytes,
    rss_end_bytes: after.rss_bytes,
    peak_rss_bytes: Math.max(...observed.map((row) => row.rss_bytes)),
    peak_private_bytes: Math.max(...observed.map((row) => row.private_bytes)),
    process_ids: [...new Set(observed.flatMap((row) => row.process_ids ?? []))],
    process_tree_observations: windowRows.length,
    metric_window_ms: Math.max(0, endEpochMs - startEpochMs),
  };
}

async function startProcessTreeMonitor(root, name, rootPid) {
  const directory = join(root, 'process-monitor', name);
  mkdirSync(directory, { recursive: true });
  const outputFile = join(directory, 'samples.jsonl');
  const stopFile = join(directory, 'stop.signal');
  const scriptPath = resolve(workspaceRoot, 'scripts/phase0/measure-native.ps1');
  const monitor = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Action', 'monitor', '-RootPid', String(rootPid), '-OutputFile', outputFile, '-StopFile', stopFile, '-IntervalMs', '100'], { cwd: workspaceRoot, stdio: 'ignore', windowsHide: true });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (existsSync(outputFile) && statSync(outputFile).size > 0) break;
    if (monitor.exitCode !== null) throw new Error(`Native process monitor exited early with ${monitor.exitCode}.`);
    await sleep(100);
  }
  if (!existsSync(outputFile) || statSync(outputFile).size === 0) {
    writeFileSync(stopFile, 'stop\n', { encoding: 'utf8', flag: 'wx' });
    throw new Error('Native process monitor did not produce a first process-tree sample.');
  }
  return {
    async stop() {
      if (!existsSync(stopFile)) writeFileSync(stopFile, 'stop\n', { encoding: 'utf8', flag: 'wx' });
      if (monitor.exitCode === null) await new Promise((resolvePromise) => monitor.once('exit', resolvePromise));
      const contents = readFileSync(outputFile, 'utf8').trim();
      return contents ? contents.split(/\r?\n/).map((line) => JSON.parse(line)) : [];
    },
  };
}

async function launchNativeApp({ executable, appDataRoot, runRoot, name, mode, index }) {
  const port = await reservePort();
  const profileIndex = mode === 'warm' ? 'shared' : String(index).padStart(2, '0');
  const webviewRoot = join(runRoot, 'native-app-data', name, mode, profileIndex);
  mkdirSync(webviewRoot, { recursive: true });
  const childEnv = {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: join(webviewRoot, 'webview2'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  };
  mkdirSync(childEnv.WEBVIEW2_USER_DATA_FOLDER, { recursive: true });
  const child = spawn(executable, [], { cwd: workspaceRoot, env: childEnv, stdio: 'ignore', windowsHide: true });
  const monitor = await startProcessTreeMonitor(runRoot, `${name}-${mode}-${index}`, child.pid);
  const startedAt = Date.now();
  try {
    const connection = await waitForNativePage(child, port);
    return { ...connection, child, monitor, startedAt, readyAt: Date.now(), webviewRoot, appDataRoot };
  } catch (error) {
    const rows = await monitor.stop();
    const cleanup = await terminateOwned(child);
    throw new Error(`${error instanceof Error ? error.message : String(error)} cleanup=${JSON.stringify(cleanup)} monitor_samples=${rows.length}`);
  }
}

async function nativeSample({ executable, appDataRoot, runRoot, name, mode, index }) {
  const session = await launchNativeApp({ executable, appDataRoot, runRoot, name, mode, index });
  let rows;
  let cleanup;
  const elapsedMs = session.readyAt - session.startedAt;
  try {
    const resolvedAppDataRoot = await invokeTauri(session.page, 'plugin:path|resolve_directory', { directory: 14 });
    if (resolve(resolvedAppDataRoot).toLowerCase() !== resolve(appDataRoot).toLowerCase()) {
      throw new Error(`Tauri app-data root did not match the isolated fixture path: ${resolvedAppDataRoot}`);
    }
    rows = await session.monitor.stop();
    await session.browser.close();
  } finally {
    cleanup = await terminateOwned(session.child);
  }
  const metrics = summarizeProcessWindow(rows, session.startedAt, session.readyAt);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || metrics.peak_rss_bytes <= 0 || cleanup.exit_code !== 0 || !cleanup.cleanup_verified || cleanup.forced_cleanup) {
    throw new Error(`Native startup isolation/cleanup/metric contract failed for ${name}-${mode}-${index}: ${JSON.stringify({ metrics, cleanup })}`);
  }
  return {
    mode,
    sample_index: index,
    elapsed_ms: elapsedMs,
    cpu_seconds: metrics.cpu_seconds,
    rss_bytes: metrics.rss_end_bytes,
    peak_rss_bytes: metrics.peak_rss_bytes,
    peak_private_bytes: metrics.peak_private_bytes,
    owned_process_ids: metrics.process_ids,
    process_tree_observations: metrics.process_tree_observations,
    cleanup_verified: cleanup.cleanup_verified,
    forced_cleanup: cleanup.forced_cleanup,
    remaining_process_ids: cleanup.remaining_process_ids,
    app_data_root: session.webviewRoot,
    tauri_app_data_root: session.appDataRoot,
    app_data_fresh_for_session: mode === 'cold' && index === 0,
    grace_outcome: cleanup,
  };
}

async function nativeSamples({ root, mode, count, executable, appDataRoot, sessionName }) {
  const samples = [];
  const commands = [executable];
  const total = mode === 'warm' ? count + 1 : count;
  for (let index = 0; index < total; index += 1) {
    const sample = await nativeSample({ executable, appDataRoot, runRoot: root, name: sessionName, mode, index });
    commands.push(`${executable} (${mode} ${index})`);
    if (!(mode === 'warm' && index === 0)) samples.push({ ...sample, sample_index: mode === 'warm' ? index - 1 : index });
  }
  return { samples, executable, commands };
}

async function invokeTauri(page, command, commandArgs = {}) {
  return page.evaluate(async ({ name, payload }) => {
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== 'function') throw new Error('Tauri invoke bridge is unavailable in the native WebView.');
    return invoke(name, payload);
  }, { name: command, payload: commandArgs });
}

async function selectCollection(page, name, expectedEntries) {
  await page.locator('button[aria-label="Choose collection"]').click();
  await page.getByRole('option', { name, exact: true }).click();
  if (expectedEntries !== undefined) {
    await page.waitForFunction((expected) => document.querySelectorAll('[role="treeitem"]').length === expected, expectedEntries, { timeout: 60000 });
  }
}

async function waitForEditorStable(page) {
  await page.locator('.cm-content').waitFor({ state: 'visible', timeout: 15000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    let previous = '';
    let stableFrames = 0;
    while (stableFrames < 5) {
      await new Promise((resolvePromise) => requestAnimationFrame(resolvePromise));
      const editor = document.querySelector('.cm-editor');
      const content = document.querySelector('.cm-content');
      if (!editor || !content) throw new Error('Editor disappeared while waiting for layout stability.');
      const editorRect = editor.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const style = window.getComputedStyle(content);
      const signature = JSON.stringify([
        content.textContent?.length ?? 0,
        content.scrollHeight,
        content.scrollLeft,
        content.scrollTop,
        editor.scrollHeight,
        editor.scrollLeft,
        editor.scrollTop,
        editorRect.x,
        editorRect.y,
        editorRect.width,
        editorRect.height,
        contentRect.width,
        contentRect.height,
        style.font,
      ]);
      if (signature === previous) stableFrames += 1;
      else stableFrames = 0;
      previous = signature;
    }
  });
  await page.waitForTimeout(100);
}

async function closeEditorThroughEmptyCollection(page) {
  await selectCollection(page, 'Phase 0 Empty', 0);
  await page.locator('.cm-content').waitFor({ state: 'detached', timeout: 15000 });
  await selectCollection(page, 'Phase 0 Native UI', 3);
}

async function measureUiOperation(page, workloadName, details, operation) {
  const startedAt = Date.now();
  const startedPerf = await page.evaluate(() => performance.now());
  const output = await operation();
  await page.evaluate(() => new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise))));
  const endedPerf = await page.evaluate(() => performance.now());
  await sleep(150);
  const finishedAt = Date.now();
  return {
    workload: workloadName,
    elapsed_ms: Math.max(0, endedPerf - startedPerf),
    started_at_epoch_ms: startedAt,
    finished_at_epoch_ms: finishedAt,
    error_count: 0,
    output,
    ...details,
  };
}

function finalizeUiSample(sample, monitorRows) {
  const metrics = summarizeProcessWindow(monitorRows, sample.started_at_epoch_ms, sample.finished_at_epoch_ms);
  const finalized = {
    ...sample,
    cpu_seconds: metrics.cpu_seconds,
    rss_start_bytes: metrics.rss_start_bytes,
    rss_end_bytes: metrics.rss_end_bytes,
    peak_rss_bytes: metrics.peak_rss_bytes,
    peak_private_bytes: metrics.peak_private_bytes,
    process_ids: metrics.process_ids,
    process_tree_observations: metrics.process_tree_observations,
    metric_window_ms: metrics.metric_window_ms,
    error_count: 0,
  };
  if (sample.workload === 'editor-open-close-lifetime-proxy-50-cycles') {
    finalized.persistent_ram_growth_bytes = metrics.rss_end_bytes - metrics.rss_start_bytes;
  }
  return finalized;
}

function workloadArtifact(name, samples, measurement, extra = {}) {
  const elapsed = samples.map((sample) => sample.elapsed_ms);
  const cpu = samples.map((sample) => sample.cpu_seconds);
  const rss = samples.map((sample) => sample.peak_rss_bytes);
  return {
    workload: name,
    metric_kind: 'native-webview-input-to-paint+whole-process-tree-rss-cpu',
    measurement,
    status: 'pass',
    error_count: samples.reduce((count, sample) => count + sample.error_count, 0),
    raw_samples: samples,
    elapsed_summary: summary(elapsed),
    cpu_seconds_summary: summary(cpu),
    peak_rss_bytes_summary: summary(rss),
    ...extra,
  };
}

async function collectFilesystemEvent(page, eventName) {
  return page.evaluate(async (name) => {
    const internal = window.__TAURI_INTERNALS__;
    if (typeof internal?.invoke !== 'function' || typeof internal.transformCallback !== 'function') {
      throw new Error('Tauri event bridge is unavailable in the native WebView.');
    }
    const state = { events: [], listenerId: null, callbackId: null };
    window.__phase0NativeEvents = state;
    state.callbackId = internal.transformCallback((event) => {
      const payload = event?.payload ?? {};
      const changes = Array.isArray(payload.changes) ? payload.changes : [];
      state.events.push({
        received_at: performance.now(),
        change_count: changes.length,
        overflow: Boolean(payload.overflow),
        event: event?.event ?? name,
      });
    });
    state.listenerId = await internal.invoke('plugin:event|listen', {
      event: name,
      target: { kind: 'Any' },
      handler: state.callbackId,
    });
    return state.listenerId;
  }, eventName);
}

async function measureWatcherBurst({ page, nativeFixtureRoot, sessionName, sampleIndex, count }) {
  const burstRoot = join(nativeFixtureRoot, 'watcher-burst');
  const entryId = `phase0-watcher-${sessionName}-${count}`;
  await invokeTauri(page, 'watch_folder', { path: burstRoot, entryId });
  const baselineEvents = await page.evaluate(() => window.__phase0NativeEvents?.events.length ?? 0);
  const prefix = `${sessionName}-${count}-${sampleIndex}`;
  const paths = [];
  const startedAt = Date.now();
  const startedPerf = await page.evaluate(() => performance.now());
  for (let index = 0; index < count; index += 1) {
    const path = join(burstRoot, `${prefix}-${String(index).padStart(4, '0')}.md`);
    writeFileSync(path, `# Native watcher burst ${index}\n\n${prefix}\n`, { encoding: 'utf8', flag: 'wx' });
    paths.push(path);
  }
  await page.waitForFunction(({ baseline, quietMs }) => {
    const events = window.__phase0NativeEvents?.events ?? [];
    const current = events.slice(baseline);
    if (current.length === 0) return false;
    return performance.now() - current[current.length - 1].received_at >= quietMs;
  }, { baseline: baselineEvents, quietMs: 300 }, { timeout: 30000 });
  const endedPerf = await page.evaluate(() => performance.now());
  const eventSummary = await page.evaluate((baseline) => {
    const events = (window.__phase0NativeEvents?.events ?? []).slice(baseline);
    return {
      event_count: events.length,
      changed_entry_count: events.reduce((count, event) => count + event.change_count, 0),
      overflow_count: events.filter((event) => event.overflow).length,
    };
  }, baselineEvents);
  const finishedAt = Date.now();
  await invokeTauri(page, 'unwatch_folder', { path: burstRoot });
  for (const path of paths) rmSync(path, { force: true });
  await sleep(150);
  if (eventSummary.event_count === 0) throw new Error(`Native watcher burst ${count} produced no visible event.`);
  return {
    workload: `watcher-burst-${count}`,
    elapsed_ms: Math.max(0, endedPerf - startedPerf),
    started_at_epoch_ms: startedAt,
    finished_at_epoch_ms: finishedAt,
    error_count: 0,
    requested_changes: count,
    ...eventSummary,
  };
}

async function runNativeUiSession({ root, executable, appDataRoot, nativeFixtureRoot, sessionName, sampleCount, typingSampleCount }) {
  const session = await launchNativeApp({ executable, appDataRoot, runRoot: root, name: sessionName, mode: 'ui', index: 0 });
  const warmupSamples = [];
  const samplesByWorkload = new Map();
  let sessionError = null;
  let monitorRows = [];
  let cleanup = null;
  let idleWindow = null;
  const addSample = (name, sample, warmup = false) => {
    if (warmup) { warmupSamples.push({ workload: name, elapsed_ms: sample.elapsed_ms }); return; }
    if (!samplesByWorkload.has(name)) samplesByWorkload.set(name, []);
    samplesByWorkload.get(name).push(sample);
  };
  const typingInputs = [
    {
      name: 'editor-typing-100KiB',
      collection_name: 'Phase 0 Typing 100 KiB',
      entry_id: 'phase0-typing-100k',
      path: join(nativeFixtureRoot, 'typing-100k.md'),
    },
    {
      name: 'editor-typing-1MiB',
      collection_name: 'Phase 0 Typing 1 MiB',
      entry_id: 'phase0-typing-1m',
      path: join(nativeFixtureRoot, 'typing-1m.md'),
    },
  ].map((input) => ({
    ...input,
    input_bytes: statSync(input.path).size,
    expected_prefix: readFileSync(input.path, 'utf8').slice(0, 64),
  }));
  for (const input of typingInputs) {
    const expectedBytes = input.name === 'editor-typing-100KiB' ? 100 * 1024 : 1024 * 1024;
    if (input.input_bytes !== expectedBytes) throw new Error(`${input.name} fixture must be exactly ${expectedBytes} bytes; got ${input.input_bytes}.`);
  }

  try {
    const resolvedAppDataRoot = await invokeTauri(session.page, 'plugin:path|resolve_directory', { directory: 14 });
    if (resolve(resolvedAppDataRoot).toLowerCase() !== resolve(appDataRoot).toLowerCase()) {
      throw new Error(`Tauri app-data root did not match the isolated fixture path: ${resolvedAppDataRoot}`);
    }
    const invokeCollections = await invokeTauri(session.page, 'get_collections');
    const expectedCollectionIds = ['fixture-smoke', 'fixture-standard', 'fixture-large', 'phase0-search-100', 'phase0-search-2000', 'phase0-typing-100k', 'phase0-typing-1m', 'phase0-native-ui', 'phase0-native-empty'];
    for (const id of expectedCollectionIds) {
      if (!invokeCollections.some((collection) => collection.id === id)) throw new Error(`Native app did not load fixture collection ${id}.`);
    }
    const idleStartedAt = Date.now();
    await sleep(1500);
    const idleFinishedAt = Date.now();
    idleWindow = { started_at_epoch_ms: idleStartedAt, finished_at_epoch_ms: idleFinishedAt };

    await selectCollection(session.page, 'Phase 0 Native UI', 3);
    for (const input of typingInputs) {
      await selectCollection(session.page, input.collection_name, 1);
      await session.page.locator(`[data-tree-item-id="entry:${input.entry_id}"]`).click();
      await session.page.waitForFunction(
        (expectedPrefix) => document.querySelector('.cm-content')?.textContent?.startsWith(expectedPrefix) === true,
        input.expected_prefix,
        { timeout: 15000 },
      );
      await session.page.locator('.cm-content').click();
      await session.page.keyboard.press('Control+End');
      await waitForEditorStable(session.page);
      for (let index = -5; index < typingSampleCount; index += 1) {
        const sample = await measureUiOperation(session.page, input.name, {
          input_bytes: input.input_bytes,
          key: 'x',
          key_count: 1,
          input_method: 'WebView2 CDP keyDown/keyUp through Playwright keyboard.press',
          document_preloaded: true,
          font_layout_stable_frames_before_measurement: 5,
          paint_barrier: 'two requestAnimationFrame callbacks',
        }, async () => {
          await session.page.keyboard.press('x');
          return { dispatched_key_count: 1, dispatched_key: 'x' };
        });
        await session.page.waitForFunction(
          () => document.querySelector('.cm-content')?.textContent?.endsWith('x') === true,
          null,
          { timeout: 15000 },
        );
        sample.output.visible_after_paint = true;
        addSample(input.name, sample, index < 0);
      }
    }

    for (const [collectionName, expectedEntries] of [['Phase 0 smoke', 100], ['Phase 0 standard', 1_000], ['Phase 0 large', 10_000]]) {
      for (let index = -1; index < sampleCount; index += 1) {
        await selectCollection(session.page, 'Phase 0 Native UI', 3);
        const sample = await measureUiOperation(session.page, `collection-render-${expectedEntries}`, { expected_entries: expectedEntries }, async () => {
          await session.page.locator('button[aria-label="Choose collection"]').click();
          await session.page.getByRole('option', { name: collectionName, exact: true }).click();
          await session.page.waitForFunction((expected) => document.querySelectorAll('[role="treeitem"]').length === expected, expectedEntries, { timeout: 60000 });
          return { rendered_entries: await session.page.locator('[role="treeitem"]').count() };
        });
        addSample(`collection-render-${expectedEntries}`, sample, index < 0);
      }
    }

    for (const collectionId of ['phase0-search-100', 'phase0-search-2000']) {
      const size = collectionId.endsWith('100') ? 100 : 2_000;
      for (const kind of ['name', 'content']) {
        const workloadName = `${kind}-search-${size}-markdown-files`;
        for (let index = -1; index < sampleCount; index += 1) {
          const sample = await measureUiOperation(session.page, workloadName, { collection_id: collectionId, markdown_files: size, query: kind === 'name' ? 'search-' : 'phase0-search-needle', api: kind === 'name' ? 'search_link_index' : 'search_note_content' }, async () => {
            const response = kind === 'name'
              ? await invokeTauri(session.page, 'search_link_index', { collectionId, query: 'search-', limit: 100 })
              : await invokeTauri(session.page, 'search_note_content', { collectionId, query: 'phase0-search-needle', offset: 0, limit: 20 });
            const resultCount = Array.isArray(response) ? response.length : (response.results?.length ?? 0);
            if (resultCount === 0) throw new Error(`Native ${kind} search returned no fixture matches for ${collectionId}.`);
            return { result_count: resultCount, scanned_files: response.scannedFiles ?? response.scanned_files ?? null, total: response.total ?? null };
          });
          addSample(workloadName, sample, index < 0);
        }
      }
    }

    const eventListenerId = await collectFilesystemEvent(session.page, 'filesystem-changes-v2');
    for (const count of [100, 1_000]) {
      for (let index = -1; index < sampleCount; index += 1) {
        const sample = await measureWatcherBurst({ page: session.page, nativeFixtureRoot, sessionName, sampleIndex: index, count });
        addSample(`watcher-burst-${count}`, sample, index < 0);
      }
    }
    await invokeTauri(session.page, 'plugin:event|unlisten', { event: 'filesystem-changes-v2', eventId: eventListenerId });

    await selectCollection(session.page, 'Phase 0 Native UI', 3);
    for (const [entryId, workloadName, waitSelector] of [
      ['phase0-chart-reopen', 'chart-reopen-cycle', '.cm-chart-widget-container[data-chart-state="ready"]'],
      ['phase0-table-reopen', 'table-reopen-cycle', '.cm-table-widget'],
    ]) {
      for (let index = -1; index < sampleCount; index += 1) {
        const row = session.page.locator(`[data-tree-item-id="entry:${entryId}"]`);
        const sample = await measureUiOperation(session.page, workloadName, { document_id: entryId, cycles: 1 }, async () => {
          await row.click();
          await session.page.locator(waitSelector).waitFor({ state: 'visible', timeout: 30000 });
          if (entryId === 'phase0-chart-reopen') {
            await session.page.locator('.chart-menu-trigger').click();
            await session.page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
            await session.page.getByRole('dialog', { name: 'Edit chart' }).waitFor({ state: 'visible', timeout: 15000 });
            await session.page.getByRole('button', { name: 'Close chart editor' }).click();
            await session.page.getByRole('dialog', { name: 'Edit chart' }).waitFor({ state: 'detached', timeout: 15000 });
          }
          await closeEditorThroughEmptyCollection(session.page);
          return { document_closed: true };
        });
        addSample(workloadName, sample, index < 0);
      }
    }

    const lifetimeRow = session.page.locator('[data-tree-item-id="entry:phase0-editor-lifetime"]');
    await sleep(2000);
    const lifetimeStartedAt = Date.now();
    const lifetimeStartedPerf = await session.page.evaluate(() => performance.now());
    for (let cycle = 0; cycle < 50; cycle += 1) {
      await lifetimeRow.click();
      await session.page.locator('.cm-content').waitFor({ state: 'visible', timeout: 15000 });
      await selectCollection(session.page, 'Phase 0 Empty', 0);
      await session.page.locator('.cm-content').waitFor({ state: 'detached', timeout: 15000 });
    await selectCollection(session.page, 'Phase 0 Native UI', 3);
    }
    const lifetimeElapsed = (await session.page.evaluate(() => performance.now())) - lifetimeStartedPerf;
    await sleep(2000);
    const lifetimeFinishedAt = Date.now();
    const lifetimeSample = {
      workload: 'editor-open-close-lifetime-proxy-50-cycles',
      elapsed_ms: lifetimeElapsed,
      started_at_epoch_ms: lifetimeStartedAt,
      finished_at_epoch_ms: lifetimeFinishedAt,
      error_count: 0,
      cycle_count: 50,
      settled_idle_after_ms: 2000,
      proxy_for: 'lightweight popup lifetime; no separate lightweight popup window exists in the current app',
    };
    addSample('editor-open-close-lifetime-proxy-50-cycles', lifetimeSample);
  } catch (error) {
    sessionError = error;
  } finally {
    try { monitorRows = await session.monitor.stop(); } catch (error) { sessionError ??= error; }
    try { await session.browser.close(); } catch (error) { sessionError ??= error; }
    try { cleanup = await terminateOwned(session.child); } catch (error) { sessionError ??= error; }
  }
  if (sessionError) throw new Error(`Native UI workload session ${sessionName} failed: ${sessionError instanceof Error ? sessionError.stack ?? sessionError.message : String(sessionError)}; cleanup=${JSON.stringify(cleanup)}`);
  if (cleanup.exit_code !== 0 || !cleanup.cleanup_verified || cleanup.forced_cleanup) {
    throw new Error(`Native UI process tree cleanup failed for ${sessionName}: ${JSON.stringify(cleanup)}`);
  }
  const nativeWorkloads = [];
  for (const [name, rawSamples] of samplesByWorkload.entries()) {
    const samples = rawSamples.map((sample) => finalizeUiSample(sample, monitorRows));
    const measurement = name.startsWith('editor-typing-')
      ? `${typingSampleCount} recorded single-key samples plus 5 warmups in this independent Windows release session`
      : `${sampleCount} measured repeats in this independent Windows release session`;
    nativeWorkloads.push(workloadArtifact(name, samples, measurement));
  }
  const validRows = monitorRows.filter((row) => Number.isFinite(row.timestamp_epoch_ms) && Number.isFinite(row.rss_bytes) && Number.isFinite(row.cpu_seconds));
  const sessionMetrics = summarizeProcessWindow(monitorRows, validRows[0]?.timestamp_epoch_ms ?? session.startedAt, validRows.at(-1)?.timestamp_epoch_ms ?? session.readyAt);
  return {
    session: sessionName,
    app_data_root: appDataRoot,
    process_monitor_samples: monitorRows.length,
    idle_process_tree: idleWindow ? summarizeProcessWindow(monitorRows, idleWindow.started_at_epoch_ms, idleWindow.finished_at_epoch_ms) : null,
    session_peak_rss_bytes: Math.max(...validRows.map((row) => row.rss_bytes)),
    session_peak_private_bytes: Math.max(...validRows.map((row) => row.private_bytes)),
    session_cpu_seconds: sessionMetrics.cpu_seconds,
    warmup_samples: warmupSamples,
    workloads: nativeWorkloads,
    cleanup,
  };
}

function nativeFixtureRoots(args, standardRoot) {
  const roots = {
    smoke: resolve(args.nativeSmokeFixtureRoot ?? ''),
    standard: standardRoot,
    large: resolve(args.nativeLargeFixtureRoot ?? ''),
  };
  for (const [profile, fixtureRoot] of Object.entries(roots)) {
    if (fixtureRoot === workspaceRoot || !existsSync(join(fixtureRoot, 'fixture-manifest.json'))) {
      throw new Error(`Native TASK-007 requires a generated ${profile} fixture root; pass --native-${profile}-fixture-root.`);
    }
    const manifest = fixtureInfo(fixtureRoot).manifest;
    if (manifest.profile !== profile) throw new Error(`Expected ${profile} fixture at ${fixtureRoot}; found ${manifest.profile}.`);
  }
  const seeds = new Set(Object.values(roots).map((fixtureRoot) => fixtureInfo(fixtureRoot).manifest.seed));
  if (seeds.size !== 1) throw new Error('Native fixture profiles must use the same fixed seed.');
  return roots;
}

function prepareNativeAppData(identifier, runId, fixtureRoots) {
  const appDataBase = process.env.APPDATA ? resolve(process.env.APPDATA) : null;
  if (!appDataBase) throw new Error('APPDATA is unavailable; refusing to guess the Windows Tauri app-data directory.');
  const appDataRoot = resolve(appDataBase, identifier);
  if (appDataRoot === appDataBase || !isWithin(appDataRoot, appDataBase)) throw new Error(`Unsafe native app-data target: ${appDataRoot}`);
  if (existsSync(appDataRoot)) throw new Error(`Refusing to reuse an existing Tauri app-data directory: ${appDataRoot}`);
  mkdirSync(appDataRoot, { recursive: false });
  writeFileSync(join(appDataRoot, '.phase0-owner'), `${runId}\n${identifier}\n`, { encoding: 'utf8', flag: 'wx' });
  const fixtureSeed = seedNativeAppData({ appDataRoot, fixtureRoots });
  return { appDataRoot, appDataBase, fixtureSeed };
}

function summarizeStartupSamples(samples) {
  return {
    elapsed_ms: metricSummary(samples, 'elapsed_ms'),
    cpu_seconds: metricSummary(samples, 'cpu_seconds'),
    rss_bytes: metricSummary(samples, 'rss_bytes'),
    peak_rss_bytes: metricSummary(samples, 'peak_rss_bytes'),
  };
}

async function runNativePhaseA({ root, args, runId, fixture, commands, backendInfo }) {
  if (process.platform !== 'win32') throw new Error('Phase A native performance baseline is Windows-only.');
  if (!Number.isInteger(args.nativeUiSamples) || args.nativeUiSamples <= 0) throw new Error('--native-ui-samples must be a positive integer.');
  if (!Number.isInteger(args.nativeTypingSamples) || args.nativeTypingSamples <= 0) throw new Error('--native-typing-samples must be a positive integer.');
  const fixtureRoots = nativeFixtureRoots(args, resolve(args.fixtureRoot));
  const sessions = [];

  for (let index = 0; index < 2; index += 1) {
    const sessionName = `native-session-${index + 1}`;
    const identifier = generatedAppIdentifier(runId, index + 1);
    validateAppIdentifier(identifier);
    const build = buildNativeRelease(root, identifier, sessionName);
    if (!build.executable || !existsSync(build.executable)) throw new Error(`Native release executable does not exist: ${build.executable}`);
    const releaseMarker = `${process.platform === 'win32' ? '\\' : '/'}target${process.platform === 'win32' ? '\\' : '/'}release${process.platform === 'win32' ? '\\' : '/'}`;
    if (!build.executable.toLowerCase().includes(releaseMarker)) throw new Error(`Native baseline requires a release executable: ${build.executable}`);
    commands.push(build.command);
    const profile = prepareNativeAppData(identifier, runId, fixtureRoots);
    const binarySha256 = sha256(readFileSync(build.executable));
    const cold = await nativeSamples({ root, mode: 'cold', count: args.nativeColdSamples, executable: build.executable, appDataRoot: profile.appDataRoot, sessionName });
    const warm = await nativeSamples({ root, mode: 'warm', count: args.nativeWarmSamples, executable: build.executable, appDataRoot: profile.appDataRoot, sessionName });
    commands.push(...cold.commands, ...warm.commands);
    const ui = await runNativeUiSession({
      root,
      executable: build.executable,
      appDataRoot: profile.appDataRoot,
      nativeFixtureRoot: profile.fixtureSeed.native_fixture_root,
      sessionName,
      sampleCount: args.nativeUiSamples,
      typingSampleCount: args.nativeTypingSamples,
    });

    sessions.push({
      session: sessionName,
      app_identifier: identifier,
      app_data_root: profile.appDataRoot,
      app_data_independent: true,
      session_independent_process: true,
      webview_user_data_profiles_independent: true,
      native_release_binary: build.executable,
      native_release_binary_sha256: binarySha256,
      build_command: build.command ?? null,
      cold_samples: cold.samples,
      warm_samples: warm.samples,
      cold_summary: summarizeStartupSamples(cold.samples),
      warm_summary: summarizeStartupSamples(warm.samples),
      native_ui: ui,
      fixture_seed: fixture.manifest.seed,
      fixture_manifest_sha256: Object.fromEntries(Object.entries(fixtureRoots).map(([profileName, fixtureRoot]) => [profileName, fixtureInfo(fixtureRoot).manifest_sha256])),
      fixture_content_root_sha256: Object.fromEntries(Object.entries(fixtureRoots).map(([profileName, fixtureRoot]) => [profileName, fixtureInfo(fixtureRoot).content_root_sha256])),
    });
  }

  const combined = new Map();
  for (const session of sessions) {
    for (const workload of session.native_ui.workloads) {
      if (!combined.has(workload.workload)) combined.set(workload.workload, []);
      combined.get(workload.workload).push(...workload.raw_samples);
    }
  }
  const workloadSummaries = [...combined.entries()].map(([name, samples]) => {
    const measurement = name.startsWith('editor-typing-')
      ? `${args.nativeTypingSamples} recorded single-key samples plus 5 warmups per size in each of two independent Windows release-build sessions (${samples.length} recorded keys total); fixed-seed documents were preloaded and settled before measurement`
      : `${args.nativeUiSamples} measured repeats in each of two independent Windows release-build sessions with fixed-seed fixtures`;
    return workloadArtifact(name, samples, measurement);
  });
  const first = sessions[0];
  const freshAppDataColdSamples = sessions.flatMap((session) => session.cold_samples.filter((sample) => sample.app_data_fresh_for_session));
  const appDataIsolation = 'fresh per-session Tauri identifier and app-data profile; each repeat uses a separate native process and WebView2 user-data profile';
  const nativeExtra = {
    isolation_required: true,
    cleanup_required: true,
    isolation: `${appDataIsolation}; each sample also uses a child-only WEBVIEW2_USER_DATA_FOLDER`,
    cleanup_evidence: 'every native process tree waited after WM_CLOSE/taskkill-no-force; forced cleanup fails the run',
    app_identifier: first.app_identifier,
    app_data_root: first.app_data_root,
    native_release_binary_sha256: first.native_release_binary_sha256,
    sessions,
    fresh_app_data_cold_samples: freshAppDataColdSamples,
    fresh_app_data_cold_summary: summarizeStartupSamples(freshAppDataColdSamples),
    task007_workload_summaries: workloadSummaries,
    typing_protocol: {
      document_sizes_bytes: { '100KiB': 100 * 1024, '1MiB': 1024 * 1024 },
      document_preloaded_before_measurement: true,
      document_stability: 'document.fonts.ready, five stable animation frames across virtualized text/layout/scroll geometry, then 100 ms idle',
      warmups_per_size_per_session: 5,
      recorded_keys_per_size_per_session: args.nativeTypingSamples,
      input: 'one printable x key via WebView2 CDP keyDown/keyUp through Playwright keyboard.press',
      paint_barrier: 'two requestAnimationFrame callbacks after each key dispatch',
      post_paint_check: 'virtualized editor text ends with the inserted x after the paint barrier',
    },
    dec_perf_01_budgets: {
      editor_1mib_typing_p95_ms: 120,
      optimized_cold_start_median_max_baseline_ratio: 1.2,
      optimized_idle_process_tree_ram_max_baseline_ratio: 1.15,
      optimized_idle_process_tree_ram_max_extra_bytes: 10 * 1024 * 1024,
      targeted_workload_p95_regression_max_ratio: 1.15,
      material_hot_path_work_reduction_min_ratio: 0.1,
      editor_open_close_50_cycle_ram_growth_max_bytes: 30 * 1024 * 1024,
      data_integrity_errors: 0,
    },
  };
  const samples = [...first.cold_samples, ...first.warm_samples];
  const coldSummary = summarizeStartupSamples(first.cold_samples);
  const warmSummary = summarizeStartupSamples(first.warm_samples);
  const nativeArtifact = artifact({
    runId,
    workload: 'native-tauri-startup-memory',
    profile: fixture.manifest.profile,
    metricKind: 'launch-to-native-webview-content-ms+whole-process-tree-rss-cpu',
    samples,
    fixture,
    commands,
    collectorSource: 'scripts/phase0/run-benchmarks.mjs + scripts/phase0/measure-native.ps1',
    provenanceExtra: { ...backendInfo, native_binary_mode: 'tauri-windows-release', native_app_identifier: first.app_identifier },
    extra: {
      cold_samples: first.cold_samples,
      warm_samples: first.warm_samples,
      cold_summary: coldSummary,
      warm_summary: warmSummary,
      native_task007: nativeExtra,
    },
  });
  nativeArtifact.contract_version = 3;
  return nativeArtifact;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfCheckSafety) {
    console.log(JSON.stringify(safetySelfCheck(), null, 2));
    return;
  }
  if (args.help || !args.fixtureRoot || !args.artifactRoot) {
    console.log('Usage: node scripts/phase0/run-benchmarks.mjs --fixture-root <standard-dir> --native-smoke-fixture-root <smoke-dir> --native-large-fixture-root <large-dir> --artifact-root artifacts/phase0 [--native-cold-samples 5] [--native-warm-samples 10] [--native-ui-samples 5] [--native-typing-samples 20] [--workload-samples 5]');
    return;
  }
  if ([args.nativeColdSamples, args.nativeWarmSamples, args.nativeUiSamples, args.nativeTypingSamples, args.workloadSamples].some((value) => !Number.isInteger(value) || value <= 0)) throw new Error('sample counts must be positive integers');
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
  const frontendBenchSuites = [
    { name: 'phase0-frontend', file: 'src/benchmarks/phase0-frontend.bench.ts', npmScript: true },
    { name: 'phase6-ui-latency', file: 'src/benchmarks/phase6-ui-latency.bench.ts', npmScript: false },
  ];
  for (let index = 0; !args.backendOnly && index < args.workloadSamples; index += 1) {
    for (const suite of frontendBenchSuites) {
      const rawPath = join(root, `frontend-${suite.name}-${index}.raw`);
      const npmArgs = suite.npmScript
        ? ['run', 'phase0:frontend-bench', '--', '--outputJson', rawPath]
        : ['exec', '--', 'vitest', 'bench', '--run', suite.file, '--outputJson', rawPath];
      const npm = npmInvocation(npmArgs);
      const result = commandRun(npm.command, npm.args);
      commands.push(result.command);
      writeFileSync(rawPath + '.stdout.txt', result.stdout + result.stderr, 'utf8');
      if (result.exit_code !== 0) throw new Error(`${suite.name} Vitest bench failed: ${result.stderr}`);
      frontendSamples.push({ sample_index: index, suite: suite.name, elapsed_ms: Math.max(0, Date.parse(result.finished_at) - Date.parse(result.started_at)), peak_rss_bytes: 0, native_webview_claim: false });
    }
  }
  if (!args.backendOnly) {
    const frontendArtifact = artifact({ runId, workload: 'frontend-pure-and-jsdom-proxy', profile: fixture.manifest.profile, metricKind: 'vitest-runner-wall-ms', samples: frontendSamples, fixture, commands, collectorSource: 'scripts/phase0/run-benchmarks.mjs', provenanceExtra: backendInfo, extra: { suites: frontendBenchSuites.map((suite) => ({ name: suite.name, file: suite.file })), labels: ['pure-algorithm', 'jsdom-proxy', 'synthetic-proxy'], native_webview_claim: false, output_files: frontendBenchSuites.flatMap((suite) => Array.from({ length: args.workloadSamples }, (_, index) => `frontend-${suite.name}-${index}.raw`)) } });
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
    nativeArtifact = await runNativePhaseA({ root, args, runId, fixture, commands, backendInfo });
  }
  if (!args.backendOnly) {
    nativeArtifact.contract_version ??= 2;
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
