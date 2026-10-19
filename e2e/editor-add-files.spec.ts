import { expect, test } from '@playwright/test';
import { installWorkspaceMock } from './helpers/workspaceMock';

for (const scenario of ['missing', 'existing', 'failed'] as const) {
  test(`Add Markdown files handles ${scenario} picker path safely`, async ({ page }) => {
    await installWorkspaceMock(page);
    await page.addInitScript(({ scenario }) => {
      const host = window as unknown as {
        __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
        __addFileCalls: string[];
      };
      const original = host.__TAURI_INTERNALS__.invoke;
      const calls: string[] = [];
      host.__addFileCalls = calls;
      const target = 'D:/Sample/Knowledge/hehe.md';
      host.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command === 'plugin:dialog|open') return [target];
        if (command === 'read_file' && args?.path === target) {
          calls.push('read');
          if (scenario !== 'existing') throw { code: 'stale_read', message: 'Missing', details: { reason: 'absent_or_create_rename' } };
          return { content: 'keep existing bytes', versionToken: 'existing-token', fileKind: 'markdown' };
        }
        if (command === 'create_file' && args?.path === target) {
          calls.push('create');
          if (scenario === 'failed') throw { code: 'save_failed', message: 'Permission denied' };
          return { versionToken: 'created-token' };
        }
        if (command === 'add_file_entries') { calls.push('add'); return []; }
        return original(command, args);
      };
    }, { scenario });
    await page.goto('/e2e/workspace.html');
    await page.getByRole('button', { name: 'Add Markdown files', exact: true }).click();
    const expected = scenario === 'missing' ? ['read', 'create', 'add'] : scenario === 'existing' ? ['read', 'add'] : ['read', 'create'];
    await expect.poll(() => page.evaluate(() => (window as unknown as { __addFileCalls: string[] }).__addFileCalls)).toEqual(expected);
    if (scenario === 'failed') await expect(page.locator('.sidebar-action-error')).toContainText('Could not add files');
  });
}
