/* global console */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const npmCli = resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');

try {
  if (!existsSync(npmCli) && process.platform === 'win32') {
    throw new Error('Install Node.js with npm before pushing; npm-cli.js is unavailable.');
  }
  const command = existsSync(npmCli) ? process.execPath : 'npm';
  const prefix = existsSync(npmCli) ? [npmCli] : [];
  for (const check of ['typecheck', 'lint']) {
    const result = spawnSync(command, [...prefix, 'run', check], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      console.error(`Push blocked: ${check} did not pass.`);
      process.exitCode = result.status ?? 1;
      break;
    }
  }
} catch (error) {
  console.error(`Push blocked: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
