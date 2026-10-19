/* global console */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scratch = mkdtempSync(join(tmpdir(), 'collectives hook-check-'));
const work = join(scratch, 'work');
const remote = join(scratch, 'remote.git');
const clone = join(scratch, 'clone');
mkdirSync(work);

function run(command, args, cwd = work) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false });
  if (result.error) throw result.error;
  return result;
}
function git(args, cwd = work) {
  const result = run('git', args, cwd);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function commit(message) {
  git(['add', '--all']);
  git(['update-index', '--chmod=+x', '.githooks/pre-push']);
  git(['-c', 'commit.gpgsign=false', 'commit', '-qm', message]);
}
function bridge(binary, args) {
  return `import { spawnSync } from 'node:child_process';\nimport process from 'node:process';\nconst result = spawnSync(process.execPath, ${JSON.stringify([binary, ...args])}, {stdio:'inherit',shell:false});\nif(result.error) throw result.error;\nprocess.exitCode=result.status??1;\n`;
}

git(['init', '--bare', '--initial-branch=main', remote], scratch);
git(['init', '--initial-branch=main']);
git(['config', 'user.name', 'Collectives hook fixture']);
git(['config', 'user.email', 'hooks@example.invalid']);
git(['remote', 'add', 'origin', remote]);
mkdirSync(join(work, '.githooks'));
mkdirSync(join(work, 'scripts/git'), { recursive: true });
for (const name of ['install-hooks.mjs', 'pre-push.mjs']) {
  copyFileSync(join(root, 'scripts/git', name), join(work, 'scripts/git', name));
}
copyFileSync(join(root, '.githooks/pre-push'), join(work, '.githooks/pre-push'));
writeFileSync(join(work, '.gitattributes'), '.githooks/* text eol=lf\n');
writeFileSync(join(work, 'package.json'), JSON.stringify({
  private: true, type: 'module', scripts: {
    typecheck: 'node typecheck.mjs', lint: 'node lint.mjs',
    'hooks:install': 'node scripts/git/install-hooks.mjs',
  },
}));
writeFileSync(join(work, 'tsconfig.json'), JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, skipLibCheck: true }, files: ['fixture.ts'],
}));
writeFileSync(join(work, 'typecheck.mjs'), bridge(join(root, 'node_modules/typescript/bin/tsc'), ['--project', 'tsconfig.json']));
writeFileSync(join(work, 'lint.mjs'), bridge(join(root, 'node_modules/eslint/bin/eslint.js'), ['fixture.js', '--max-warnings', '0']));
writeFileSync(join(work, 'eslint.config.mjs'), "export default [{files:['fixture.js'],rules:{'no-unused-vars':'warn'}}];\n");
writeFileSync(join(work, 'fixture.ts'), "export const value: number = 'invalid';\n");
writeFileSync(join(work, 'fixture.js'), 'export const used = 1;\n');
const installed = run(process.execPath, ['scripts/git/install-hooks.mjs']);
assert.equal(installed.status, 0, installed.stderr);
commit('fixture: type error');
const typeError = run('git', ['push', 'origin', 'main']);
assert.notEqual(typeError.status, 0);
assert.match(typeError.stdout + typeError.stderr, /TS2322/);
assert.notEqual(run('git', ['--git-dir', remote, 'rev-parse', '--verify', 'refs/heads/main']).status, 0);

writeFileSync(join(work, 'fixture.ts'), 'export const value: number = 1;\n');
writeFileSync(join(work, 'fixture.js'), 'const unused = 1;\n');
commit('fixture: lint warning');
const lintError = run('git', ['push', 'origin', 'main']);
assert.notEqual(lintError.status, 0);
assert.match(lintError.stdout + lintError.stderr, /no-unused-vars/);
assert.notEqual(run('git', ['--git-dir', remote, 'rev-parse', '--verify', 'refs/heads/main']).status, 0);

writeFileSync(join(work, 'fixture.js'), 'export const used = 1;\n');
commit('fixture: clean');
const clean = run('git', ['push', 'origin', 'main']);
assert.equal(clean.status, 0, clean.stdout + clean.stderr);
assert.equal(git(['--git-dir', remote, 'rev-parse', 'refs/heads/main']), git(['rev-parse', 'HEAD']));
git(['clone', remote, clone], scratch);
const reinstall = run(process.execPath, ['scripts/git/install-hooks.mjs'], clone);
assert.equal(reinstall.status, 0, reinstall.stderr);
assert.equal(git(['config', '--local', '--get', 'core.hooksPath'], clone), '.githooks');
assert.ok(git(['ls-files', '--stage', '.githooks/pre-push'], clone).startsWith('100755'));
assert.ok(!readFileSync(join(clone, '.githooks/pre-push'), 'utf8').includes('\r'));
git(['config', '--local', 'core.hooksPath', 'custom-hooks'], clone);
const preserved = run(process.execPath, ['scripts/git/install-hooks.mjs'], clone);
assert.notEqual(preserved.status, 0);
assert.equal(git(['config', '--local', '--get', 'core.hooksPath'], clone), 'custom-hooks');
const archive = join(scratch, 'source-archive');
mkdirSync(join(archive, 'scripts/git'), { recursive: true });
copyFileSync(join(root, 'scripts/git/install-hooks.mjs'), join(archive, 'scripts/git/install-hooks.mjs'));
const skippedArchive = run(process.execPath, ['scripts/git/install-hooks.mjs'], archive);
assert.equal(skippedArchive.status, 0, skippedArchive.stderr);
assert.match(skippedArchive.stdout, /not a Git checkout root/);

const evidence = {
  status: 'pass', scratch,
  typeError: { exitCode: typeError.status, output: typeError.stdout + typeError.stderr },
  lintError: { exitCode: lintError.status, output: lintError.stdout + lintError.stderr },
  clean: { exitCode: clean.status, output: clean.stdout + clean.stderr },
  freshClone: { installed: true, executable: true, lf: true },
  existingHooksPreserved: true,
  sourceArchiveSkipped: true,
};
mkdirSync(join(root, 'artifacts/task013'), { recursive: true });
writeFileSync(join(root, 'artifacts/task013/hook-verification.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ status: 'pass', typeErrorBlocked: true, lintWarningBlocked: true, cleanPushPassed: true, freshCloneInstalled: true, scratch }, null, 2));
