/* global console */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { load } from 'js-yaml';

const workflow = load(readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'));
const policy = JSON.parse(readFileSync(new URL('../../.github/main-branch-protection.json', import.meta.url), 'utf8'));
const fixed = ['frontend', 'browser', 'phase0-smoke'];
for (const name of [...fixed, 'backend']) {
  assert.ok(workflow.jobs[name], `Missing required CI job: ${name}`);
  assert.equal(workflow.jobs[name].name, undefined, 'Update policy mapping when naming CI jobs.');
}
assert.equal(workflow.jobs.backend.strategy['fail-fast'], false);
assert.deepEqual(workflow.jobs.backend.strategy.matrix.os, ['ubuntu-latest', 'windows-latest', 'macos-latest']);
const expected = [...fixed, ...workflow.jobs.backend.strategy.matrix.os.map((os) => `backend (${os})`)];
assert.equal(policy.required_status_checks.strict, true);
assert.equal(policy.enforce_admins, true);
assert.equal(policy.allow_force_pushes, false);
assert.equal(policy.allow_deletions, false);
const checks = policy.required_status_checks.checks;
assert.deepEqual(checks.map((check) => check.context).sort(), expected.sort());
assert.ok(checks.every((check) => check.app_id === 15368), 'Require checks from the verified GitHub Actions app.');
assert.ok(workflow.jobs.frontend.steps.some((step) => step.run?.includes('npm run test:hooks')));
assert.ok(workflow.jobs.frontend.steps.some((step) => step.run?.includes('npm run check:ci-policy')));
console.log('PASS: main protection requires all canonical CI jobs and three backend platforms from GitHub Actions.');
