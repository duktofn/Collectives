#!/usr/bin/env node
/* global console */
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { existsSync, lstatSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { dirname, parse, resolve } from 'node:path';
import process from 'node:process';

const workspaceRoot = resolve(import.meta.dirname, '../..');
const manifestPath = resolve(workspaceRoot, 'test-fixtures/phase0/manifest.json');
const forbiddenRoots = [process.env.APPDATA, process.env.LOCALAPPDATA, process.env.ProgramData]
  .filter(Boolean)
  .map((path) => resolve(path));
const temporaryRoots = [process.env.TEMP, process.env.TMP].filter(Boolean).map((path) => resolve(path));

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function seedValue(seed) {
  let value = 2166136261;
  for (const character of seed) {
    value ^= character.codePointAt(0);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value || 1;
}

function random(seed) {
  let state = seedValue(seed);
  return () => {
    state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) >>> 0;
    let output = Math.imul(state ^ (state >>> 7), 61 | state) ^ state;
    output = (output ^ (output >>> 14)) >>> 0;
    return output / 4294967296;
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function trustedZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const checksum = crc32(data);
    const header = Buffer.concat([
      Buffer.from('PK\x03\x04', 'binary'), u16(20), u16(0), u16(0), u16(0), u16(0), u32(checksum),
      u32(data.length), u32(data.length), u16(nameBuffer.length), u16(0), nameBuffer, data,
    ]);
    local.push(header);
    central.push(Buffer.concat([
      Buffer.from('PK\x01\x02', 'binary'), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(checksum),
      u32(data.length), u32(data.length), u16(nameBuffer.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuffer,
    ]));
    offset += header.length;
  }
  const centralBuffer = Buffer.concat(central);
  return Buffer.concat([
    ...local,
    centralBuffer,
    Buffer.from('PK\x05\x06\x00\x00\x00\x00', 'binary'), u16(entries.length), u16(entries.length),
    u32(centralBuffer.length), u32(offset), u16(0),
  ]);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out') args.out = argv[++index];
    else if (argv[index] === '--profile') args.profile = argv[++index];
    else if (argv[index] === '--seed') args.seed = argv[++index];
    else if (argv[index] === '--manifest') args.manifest = argv[++index];
    else if (argv[index] === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return args;
}

function ensureSafeOutput(output) {
  const absolute = resolve(output);
  const workspace = resolve(workspaceRoot);
  const parent = resolve(dirname(absolute));
  if (absolute === workspace || absolute === parse(absolute).root || absolute === parent) throw new Error('Output must be a new child directory');
  if (absolute.startsWith(`${workspace}${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error('Fixture output cannot be inside the workspace');
  const isTemporary = temporaryRoots.some((root) => absolute === root || absolute.startsWith(`${root}${process.platform === 'win32' ? '\\' : '/'}`));
  if (forbiddenRoots.some((root) => absolute === root || absolute.startsWith(`${root}${process.platform === 'win32' ? '\\' : '/'}`)) && !isTemporary) throw new Error('Fixture output cannot be inside an app-data root');
  if (existsSync(absolute)) {
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error('Fixture output cannot be a symlink/reparse root');
    throw new Error(`Fixture output already exists; refusing overwrite: ${absolute}`);
  }
  if (!existsSync(parent)) throw new Error(`Fixture output parent does not exist: ${parent}`);
  const parentStat = lstatSync(parent);
  if (parentStat.isSymbolicLink()) throw new Error('Fixture output parent cannot be a symlink/reparse root');
  return absolute;
}

function freeBytes(path) {
  try {
    const stats = statfsSync(path);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch (error) {
    throw new Error(`Unable to measure free space before fixture generation: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeFile(root, relativePath, content, state) {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  state.bytes += data.length;
  if (state.bytes > state.profile.generated_cap_bytes) throw new Error('Fixture generated cap exceeded before completing output');
  const absolute = resolve(root, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, data);
  state.files.push({ path: relativePath.replaceAll('\\', '/'), bytes: data.length, sha256: sha256(data) });
}

function buildFixture(args) {
  const template = JSON.parse(readFileSync(args.manifest ?? manifestPath, 'utf8'));
  const profile = template.profiles[args.profile];
  if (!profile) throw new Error(`Unknown fixture profile: ${args.profile}`);
  if (!args.seed) throw new Error('--seed is required for reproducibility');
  const output = ensureSafeOutput(args.out);
  const available = freeBytes(dirname(output));
  if (available < profile.free_space_preflight_bytes) throw new Error(`Insufficient free space: ${available} < ${profile.free_space_preflight_bytes}`);
  const randomValue = random(args.seed);
  const state = { bytes: 0, files: [], profile };
  const collectionEntries = [];
  const trustedAssetEntries = [];
  for (let index = 0; index < profile.collection_entries; index += 1) {
    const depth = index % profile.max_depth;
    const directory = `notes/level-${depth}`;
    const id = `entry-${String(index).padStart(6, '0')}`;
    const links = [];
    if (index > 0 && randomValue() < profile.link_density) links.push(`[[entry-${String(Math.floor(randomValue() * index)).padStart(6, '0')}]]`);
    const markdown = randomValue() < profile.markdown_density ? `# Note ${index}\n\nSeed ${args.seed}. ${links.join(' ')}\n` : `Note ${index}\n`;
    const path = `${directory}/${id}.md`;
    writeFile(output, path, markdown, state);
    collectionEntries.push({ type: 'file', id, path });
    trustedAssetEntries.push([`assets/${id}.md`, markdown]);
  }
  const collectionDefinition = { id: `fixture-${args.profile}`, schemaVersion: 1, name: `Phase 0 ${args.profile}`, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', entries: collectionEntries, metadata: null };
  writeFile(output, 'collection/collection.json', `${JSON.stringify(collectionDefinition, null, 2)}\n`, state);
  const ioBuffer = Buffer.alloc(profile.io_bytes);
  for (let index = 0; index < ioBuffer.length; index += 1) ioBuffer[index] = (index * 31 + seedValue(args.seed)) & 0xff;
  writeFile(output, 'io/payload.bin', ioBuffer, state);
  const indexLines = Array.from({ length: profile.index_entries }, (_, index) => JSON.stringify({ id: `index-${index}`, displayName: `Note ${index % profile.collection_entries}`, path: `notes/level-${index % profile.max_depth}/entry-${String(index % profile.collection_entries).padStart(6, '0')}.md` })).join('\n') + '\n';
  writeFile(output, 'index/index.jsonl', indexLines, state);
  const watcherLines = Array.from({ length: profile.watcher_events }, (_, index) => JSON.stringify({ event: 'modify', path: `notes/level-${index % profile.max_depth}/entry-${String(index % profile.collection_entries).padStart(6, '0')}.md` })).join('\n') + '\n';
  writeFile(output, 'watcher/events.jsonl', watcherLines, state);
  const trustedManifest = { ...collectionDefinition, entries: collectionEntries.map(({ type, id }) => ({ type, id, path: `assets/${id}.md` })) };
  const zipManifest = JSON.stringify(trustedManifest, null, 2);
  writeFile(output, 'trusted/fixture.zip', trustedZip([['manifest.json', zipManifest], ...trustedAssetEntries]), state);
  state.files.sort((left, right) => left.path.localeCompare(right.path));
  const contentRoot = sha256(state.files.map((file) => `${file.path}\0${file.sha256}\n`).join(''));
  const contentFiles = [...state.files];
  const contentBytes = state.bytes;
  const generatedManifest = {
    manifest_version: template.manifest_version,
    generator: template.generator,
    profile: args.profile,
    seed: args.seed,
    generated_cap_bytes: profile.generated_cap_bytes,
    free_space_preflight_bytes: profile.free_space_preflight_bytes,
    profile_definition: profile,
    generated_bytes: contentBytes,
    content_root_sha256: contentRoot,
    files: contentFiles,
    trusted_zip_paths: ['trusted/fixture.zip'],
  };
  writeFile(output, 'fixture-manifest.json', `${JSON.stringify(generatedManifest, null, 2)}\n`, state);
  return { output, generatedManifest, contentRoot, bytes: contentBytes, fileCount: contentFiles.length };
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.out || !args.profile) {
    console.log('Usage: node scripts/phase0/generate-fixtures.mjs --out <new-dir> --profile <smoke|standard|large> --seed <fixed-seed> [--manifest <path>]');
    process.exit(args.help ? 0 : 2);
  }
  const result = buildFixture(args);
  console.log(JSON.stringify({ status: 'pass', output: result.output, profile: result.generatedManifest.profile, seed: result.generatedManifest.seed, content_root_sha256: result.contentRoot, generated_bytes: result.bytes, file_count: result.fileCount }, null, 2));
} catch (error) {
  console.error(`generate-fixtures failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
