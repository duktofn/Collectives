import { spawn } from 'node:child_process';
import console from 'node:console';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tauriConfigPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const cargoManifestPath = path.join(root, 'src-tauri', 'Cargo.toml');
const packagePath = path.join(root, 'package.json');
const config = JSON.parse(await readFile(tauriConfigPath, 'utf8'));
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
const cargoManifest = await readFile(cargoManifestPath, 'utf8');
const version = config.version;

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`Expected a release version in x.y.z format, received: ${version}`);
}
if (packageJson.version !== version || !new RegExp(`^version = "${version.replaceAll('.', '\\.')}"$`, 'm').test(cargoManifest)) {
  throw new Error('App versions do not match. Sync package.json, tauri.conf.json, and Cargo.toml before building.');
}

const changelog = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
const sections = Array.from(changelog.matchAll(/^## \[([^\]]+)\].*$/gm));
const sectionIndex = sections.findIndex((section) => section[1] === version);
if (sectionIndex < 0) {
  throw new Error(`Add a ## [${version}] entry to CHANGELOG.md before building this release.`);
}
const releaseChangelog = '# Changelog\n\n' + changelog.slice(
  sections[sectionIndex].index,
  sections[sectionIndex + 1]?.index ?? changelog.length,
).trim() + '\n';

const tauriCli = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const build = spawn(process.execPath, [tauriCli, 'build'], {
  cwd: root,
  stdio: 'inherit',
});
const exitCode = await new Promise((resolve, reject) => {
  build.once('error', reject);
  build.once('exit', (code, signal) => {
    if (signal) reject(new Error(`Tauri build stopped by ${signal}`));
    else resolve(code ?? 1);
  });
});
if (exitCode !== 0) process.exit(exitCode);

const releaseDir = path.join(root, 'release', version);
const binaryPath = path.join(root, 'src-tauri', 'target', 'release', process.platform === 'win32' ? 'tauri-app.exe' : 'tauri-app');
await stat(binaryPath);
await mkdir(releaseDir, { recursive: true });
const executableName = `Collective-${version}${process.platform === 'win32' ? '.exe' : ''}`;
await copyFile(binaryPath, path.join(releaseDir, executableName));

async function findFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findFiles(entryPath);
    return entry.isFile() ? [entryPath] : [];
  }));
  return nested.flat();
}

const bundleRoot = path.join(root, 'src-tauri', 'target', 'release', 'bundle');
const bundleFiles = (await findFiles(bundleRoot)).filter((file) => {
  const extension = path.extname(file).toLowerCase();
  return ['.exe', '.msi', '.dmg', '.appimage', '.deb', '.rpm', '.app', '.sig'].includes(extension)
    && path.basename(file).includes(version);
});

for (const source of bundleFiles) {
  const extension = path.extname(source).toLowerCase();
  const rawName = path.basename(source, path.extname(source))
    .replace(/^collectives?[_-]?/i, '')
    .replaceAll(version, '')
    .replace(/^[_.-]+|[_.-]+$/g, '')
    .replace(/[^a-zA-Z0-9.-]+/g, '-')
    .replace(/-+/g, '-');
  const suffix = rawName ? `-${rawName}` : '';
  await copyFile(source, path.join(releaseDir, `Collective-${version}${suffix}${extension}`));
}

await writeFile(path.join(releaseDir, 'changelog.md'), releaseChangelog, 'utf8');
console.log(`Release files for Collective ${version} are in ${releaseDir}`);
