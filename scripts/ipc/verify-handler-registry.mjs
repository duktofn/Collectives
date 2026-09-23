#!/usr/bin/env node
/* global console, URL */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { generate } from './generate-contracts.mjs';

const workspaceRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const manifestPath = join(workspaceRoot, 'contracts/ipc.v1.json');
const rustGeneratedPath = join(workspaceRoot, 'src-tauri/src/ipc/generated.rs');
const libPath = join(workspaceRoot, 'src-tauri/src/lib.rs');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function verifyRegistry(manifest, generated) {
  const records = [...generated.matchAll(/CommandMetadata \{\s*name: "([^"]+)",\s*handler: "([^"]+)",?\s*\}/g)]
    .map((match) => ({ name: match[1], handler: match[2] }));
  const expected = [...manifest.commands, ...(manifest.metadataCommands ?? [])];
  assert(records.length === expected.length, `generated registry count mismatch: ${records.length}`);
  for (const [index, command] of expected.entries()) {
    assert(records[index]?.name === command.name, `generated command mismatch at ${index}: ${records[index]?.name}`);
    assert(records[index]?.handler === command.handler, `generated handler mismatch for ${command.name}`);
  }
  assert(generated.includes(`pub const IPC_COMMAND_COUNT: usize = ${manifest.commands.length};`), 'generated command count metadata missing');
}

function verifyLibUsesGeneratedRegistry(lib) {
  assert(lib.includes('.invoke_handler(crate::generated_ipc_handler!())'), 'lib.rs does not consume generated handler macro');
  assert(!lib.includes('tauri::generate_handler!['), 'lib.rs contains a second manual generate_handler registry');
}

function verifyNegativeFixtures(manifest) {
  const directory = mkdtempSync(join(tmpdir(), 'collectives-ipc-negative-'));
  try {
    const missingPath = join(directory, 'missing.json');
    const missing = JSON.parse(JSON.stringify(manifest));
    missing.commands = missing.commands.slice(0, -1);
    writeFileSync(missingPath, JSON.stringify(missing));
    let missingFailed = false;
    try { generate({ check: true, manifest: missingPath }); } catch { missingFailed = true; }
    assert(missingFailed, 'negative missing-command manifest unexpectedly passed');

    const extraPath = join(directory, 'extra.json');
    const extra = JSON.parse(JSON.stringify(manifest));
    extra.commands = [...extra.commands, {...extra.commands[0], name: 'deliberate_extra_command'}];
    writeFileSync(extraPath, JSON.stringify(extra));
    let extraFailed = false;
    try { generate({ check: true, manifest: extraPath }); } catch { extraFailed = true; }
    assert(extraFailed, 'negative extra-command manifest unexpectedly passed');
    return { missingCommand: 'pass', extraCommand: 'pass' };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

try {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const generated = readFileSync(rustGeneratedPath, 'utf8');
  const lib = readFileSync(libPath, 'utf8');
  verifyRegistry(manifest, generated);
  verifyLibUsesGeneratedRegistry(lib);
  const negative = verifyNegativeFixtures(manifest);
  console.log(JSON.stringify({ status: 'pass', commandCount: manifest.commands.length, eventCount: manifest.events.length, generatedRegistry: 'match', handlerProof: 'lib.rs uses generated macro', negativeTests: negative }, null, 2));
} catch (error) {
  console.error(`verify-handler-registry failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
