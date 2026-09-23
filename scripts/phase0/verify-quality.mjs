#!/usr/bin/env node
/* global console */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const workspaceRoot = resolve(import.meta.dirname, '../..');

function npmInvocation(args = []) {
  const npmCli = resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (existsSync(npmCli)) return { command: process.execPath, args: [npmCli, ...args] };
  if (process.platform !== 'win32') return { command: 'npm', args };
  throw new Error(`npm-cli.js not found at ${npmCli}; refusing shell-based npm fallback`);
}

function tool(command) {
  if (command === 'npm') {
    const npm = npmInvocation(['--version']);
    return execFileSync(npm.command, npm.args, { cwd: workspaceRoot, encoding: 'utf8' }).trim();
  }
  const candidates = process.platform === 'win32' && command !== 'git' ? [command, `${command}.cmd`, `${command}.exe`] : [command];
  for (const candidate of candidates) {
    try {
      return execFileSync(candidate, ['--version'], { cwd: workspaceRoot, encoding: 'utf8' }).trim();
    } catch {
      // Try the next executable spelling on Windows.
    }
  }
  return 'unavailable';
}

function run(command, args, cwd = workspaceRoot) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: process.env, shell: false });
  const finishedAt = new Date().toISOString();
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  return { command: [command, ...args].join(' '), cwd, started_at: startedAt, finished_at: finishedAt, exit_code: result.status ?? 1, signal: result.signal, stdout, stderr };
}

function parseArgs(argv) {
  const args = { target: argv[0] };
  if (args.target !== 'frontend' && args.target !== 'backend') throw new Error('Target must be frontend or backend');
  return args;
}

function frontendTestPolicy() {
  const testFiles = [];
  const excludedBenchmarkFiles = ['src/benchmarks/phase0-frontend.bench.ts'];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.(test|spec)\.[cm]?[jt]sx?$/.test(path.replaceAll('\\', '/'))) testFiles.push(path);
    }
  }
  visit(resolve(workspaceRoot, 'src'));
  const forbidden = /\b(?:describe|it|test|suite)\s*\.\s*(?:only|skip|todo)\s*\(|\b(?:xdescribe|xit|xtest|fit|fdescribe)\s*\(/g;
  const violations = [];
  for (const path of testFiles) {
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(forbidden)) violations.push({ path: path.replace(`${workspaceRoot}/`, '').replaceAll('\\', '/'), token: match[0].trim() });
  }
  if (violations.length) throw new Error(`frontend test policy violation: ${JSON.stringify(violations)}`);
  return { status: 'pass', scanned_test_files: testFiles.map((path) => path.replace(`${workspaceRoot}/`, '').replaceAll('\\', '/')), excluded_documented_benchmark_files: excludedBenchmarkFiles, forbidden_patterns: ['describe/it/test/suite.only', 'describe/it/test/suite.skip', 'describe/it/test/suite.todo', 'xdescribe/xit/xtest/fit/fdescribe'] };
}

try {
  const args = parseArgs(process.argv.slice(2));
  const testPolicy = args.target === 'frontend' ? frontendTestPolicy() : { status: 'not-applicable' };
  const npm = npmInvocation();
  const commands = args.target === 'frontend'
    ? [
      [npm.command, [...npm.args, 'run', 'typecheck']],
      [npm.command, [...npm.args, 'run', 'lint']],
      [npm.command, [...npm.args, 'run', 'test', '--', '--run', '--allowOnly=false']],
      [npm.command, [...npm.args, 'run', 'build']],
    ]
    : [
      ['cargo', ['fmt', '--all', '--', '--check']],
      ['cargo', ['clippy', '--locked', '--all-targets', '--', '-D', 'warnings']],
      ['cargo', ['test', '--locked', '--all-targets']],
    ];
  const results = commands.map(([command, commandArgs]) => run(command, commandArgs, args.target === 'backend' ? resolve(workspaceRoot, 'src-tauri') : workspaceRoot));
  const record = {
    schema_version: 1,
    kind: 'quality-log',
    target: args.target,
    status: results.every((result) => result.exit_code === 0) ? 'pass' : 'fail',
    exit_code: results.every((result) => result.exit_code === 0) ? 0 : 1,
    error: results.find((result) => result.exit_code !== 0)?.stderr || null,
    run_id: `quality-${args.target}-${new Date().toISOString().replace(/[-:.TZ]/g, '')}`,
    workload: 'quality-gates',
    profile: 'canonical',
    metric_kind: 'exit-code',
    raw_samples: results.map((result) => ({ command: result.command, exit_code: result.exit_code, duration_ms: Math.max(0, Date.parse(result.finished_at) - Date.parse(result.started_at)) })),
    summary: { count: results.length, p50: null, p95: null, max: null, nearest_rank: 'not applicable for exit-code samples' },
    provenance: { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot, encoding: 'utf8' }).trim(), node: tool('node'), npm: tool('npm'), rustc: tool('rustc'), cargo: tool('cargo'), commands: results.map((result) => result.command), collector_source: 'scripts/phase0/verify-quality.mjs' },
    test_policy: testPolicy,
    results,
  };
  const logRoot = resolve(workspaceRoot, 'artifacts/phase0/quality-logs');
  mkdirSync(logRoot, { recursive: true });
  const logPath = resolve(logRoot, `${record.run_id}.json`);
  if (!existsSync(logPath)) writeFileSync(logPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status: record.status, log_path: logPath, target: args.target }, null, 2));
  if (record.exit_code !== 0) process.exitCode = 1;
} catch (error) {
  console.error(`verify-quality failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
