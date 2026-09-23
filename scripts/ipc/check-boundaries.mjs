#!/usr/bin/env node
/* global console */
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const workspaceRoot = resolve(import.meta.dirname, '../..');
const sourceRoot = resolve(workspaceRoot, 'src');
const explicitExemptions = {
  'src/benchmarks/phase0-frontend.bench.ts': 'Phase 0 Vitest benchmark mocks the native Tauri APIs; it never runs product code.',
};

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'target', 'artifacts'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (['.ts', '.tsx'].includes(extname(path))) files.push(path);
  }
  return files;
}

function walkRust(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkRust(path));
    else if (entry.name.endsWith('.rs')) files.push(path);
  }
  return files;
}

function isAllowedRawGateway(path) {
  const normalized = path.replaceAll('\\', '/');
  return normalized.includes('/src/shared/ipc/') || normalized.includes('/src/platform/');
}

function isStoreOrComponent(path) {
  return path.includes('/src/stores/') || path.includes('/src/components/');
}

function analyzeSource(path, sourceText) {
  const fileName = path.replaceAll('\\', '/');
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const violations = [];
  const exempt = explicitExemptions[relative(workspaceRoot, path).replaceAll('\\', '/')];
  function add(node, message) {
    const position = source.getLineAndCharacterOfPosition(node.getStart(source));
    violations.push({ file: fileName, line: position.line + 1, message });
  }
  if (fileName.endsWith('/src/lib/tauri.ts')) {
    for (const statement of source.statements) {
      if (!ts.isExportDeclaration(statement)) add(statement, 'legacy facade must contain re-export declarations only');
    }
  }
  source.forEachChild((node) => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
    const moduleName = node.moduleSpecifier.text;
    if (moduleName.startsWith('@tauri-apps/')) {
      if (!isAllowedRawGateway(path) && !exempt) add(node.moduleSpecifier, `raw Tauri/plugin import outside shared/platform: ${moduleName}`);
      return;
    }
    if (moduleName.includes('/lib/tauri') || moduleName === '../tauri') {
      if (!fileName.endsWith('/src/lib/tauri.ts')) add(node.moduleSpecifier, 'legacy lib/tauri implementation import; use a feature public index');
      return;
    }
    if (isStoreOrComponent(path) && (moduleName.includes('/infrastructure/') || moduleName.includes('/shared/ipc/client'))) {
      add(node.moduleSpecifier, 'store/component imports infrastructure or raw IPC client instead of feature public index');
    }
  });
  return { violations, exemption: exempt ?? null };
}

function runNegativeTests() {
  const cases = [
    { path: '/virtual/src/stores/bad.ts', source: 'import { invoke } from "@tauri-apps/api/core";', expected: 'raw Tauri' },
    { path: '/virtual/src/components/bad.tsx', source: 'import { adapter } from "../features/archive/infrastructure/ipc";', expected: 'infrastructure' },
  ];
  return cases.map((testCase) => {
    const result = analyzeSource(testCase.path, testCase.source);
    const passed = result.violations.some((violation) => violation.message.includes(testCase.expected));
    if (!passed) throw new Error(`negative boundary fixture unexpectedly passed: ${testCase.expected}`);
    return { case: testCase.expected, status: 'pass' };
  });
}

try {
  const violations = [];
  const exemptions = [];
  for (const file of walk(sourceRoot)) {
    const result = analyzeSource(file, readFileSync(file, 'utf8'));
    violations.push(...result.violations);
    if (result.exemption) exemptions.push({ file: relative(workspaceRoot, file).replaceAll('\\', '/'), reason: result.exemption });
  }
  const backendCommandRoot = resolve(workspaceRoot, 'src-tauri/src/ipc/commands');
  for (const file of walkRust(backendCommandRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const forbidden of ['std::fs', 'rusqlite', 'crate::collection::manager', 'crate::collection::archive', 'crate::link_index']) {
      if (source.includes(forbidden)) violations.push({ file: relative(workspaceRoot, file).replaceAll('\\', '/'), line: 1, message: `backend IPC command imports persistence/business implementation: ${forbidden}` });
    }
  }
  const servicePath = resolve(workspaceRoot, 'src-tauri/src/application/services.rs');
  const serviceSource = readFileSync(servicePath, 'utf8');
  for (const forbidden of ['crate::commands', 'crate::collection', 'crate::settings', 'crate::fs_ops', 'crate::font_manager', 'crate::theme_io', 'crate::link_index', 'std::fs', 'rusqlite']) {
    if (serviceSource.includes(forbidden)) {
      violations.push({ file: 'src-tauri/src/application/services.rs', line: 1, message: `application service imports direct persistence/business implementation: ${forbidden}` });
    }
  }
  const legacyShim = readFileSync(resolve(workspaceRoot, 'src-tauri/src/commands.rs'), 'utf8');
  if (legacyShim.includes('std::fs') || legacyShim.includes('#[tauri::command]') || /\bpub fn\s+/.test(legacyShim)) {
    violations.push({ file: 'src-tauri/src/commands.rs', line: 1, message: 'commands.rs must remain re-export-only compatibility shim' });
  }
  const libSource = readFileSync(resolve(workspaceRoot, 'src-tauri/src/lib.rs'), 'utf8');
  if (!libSource.includes('AppServices::from_app') || !libSource.includes('app.manage(services)')) {
    violations.push({ file: 'src-tauri/src/lib.rs', line: 1, message: 'managed AppServices composition is not proven in startup setup' });
  }
  const negativeTests = runNegativeTests();
  if (violations.length > 0) {
    console.error(JSON.stringify({ status: 'fail', violations, exemptions, negativeTests }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ status: 'pass', productionExemptions: 0, exemptions, violations: [], negativeTests }, null, 2));
  }
} catch (error) {
  console.error(`check-boundaries failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
