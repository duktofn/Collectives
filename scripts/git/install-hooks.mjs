/* global console */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });

try {
  const top = git('rev-parse', '--show-toplevel');
  const normalize = (path) => process.platform === 'win32'
    ? resolve(path).toLowerCase() : resolve(path);
  if (top.status !== 0 || normalize(top.stdout.trim()) !== normalize(root)) {
    console.log('Git hooks not installed: this folder is not a Git checkout root.');
  } else {
    const configured = git('config', '--get', 'core.hooksPath').stdout.trim();
    if (configured && configured !== '.githooks') {
      throw new Error(`Existing core.hooksPath (${configured}) was preserved. Integrate the pre-push check with your current hooks before pushing.`);
    }
    if (!configured) {
      const hooks = resolve(root, git('rev-parse', '--git-path', 'hooks').stdout.trim());
      const custom = existsSync(hooks)
        ? readdirSync(hooks, { withFileTypes: true })
          .filter((entry) => entry.isFile() && !entry.name.endsWith('.sample'))
        : [];
      if (custom.length) throw new Error('Existing custom Git hooks were preserved. Integrate the pre-push check with them first.');
    }
    chmodSync(resolve(root, '.githooks/pre-push'), 0o755);
    const result = git('config', '--local', 'core.hooksPath', '.githooks');
    if (result.status !== 0) throw new Error(result.stderr.trim() || 'Could not configure Git hooks.');
    console.log('Git pre-push checks installed: typecheck and lint.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
