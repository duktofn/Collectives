import { expect, test, type Page } from '@playwright/test';
import { installWorkspaceMock } from './helpers/workspaceMock';

const csharp = [
  '[Serializable]',
  'public class Session {',
  '  private CombatSettingsSO _settings;',
  '  private int _count = 42;',
  '  public CombatSession Current { get; private set; }',
  '  private void Awake() {',
  '    if (_settings == null) return;',
  '    _settings.Validate();',
  '    var message = "private CombatSettingsSO";',
  '  }',
  '}',
].join('\n');

async function rgb(page: Page, value: string) {
  return page.evaluate((value) => {
    const probe = document.createElement('span');
    probe.style.color = value;
    document.body.appendChild(probe);
    const result = getComputedStyle(probe).color;
    probe.remove();
    return result;
  }, value);
}

for (const theme of ['dark', 'light'])
  test(`C# role colors follow settings and line numbers stay flush left in ${theme}`, async ({
    page,
  }) => {
    await installWorkspaceMock(page, theme, false, false, undefined, undefined, {
      'Session.cs': csharp,
    });
    await page.goto('/e2e/workspace.html');
    const modifier = page
      .locator('.cm-token-modifier')
      .filter({ hasText: /^private$/ })
      .first();
    const type = page.locator('.cm-token-type').filter({ hasText: /^CombatSettingsSO$/ });
    const variable = page
      .locator('.cm-token-variable')
      .filter({ hasText: /^_settings$/ })
      .first();
    const keyword = page.locator('.cm-token-keyword').filter({ hasText: /^return$/ });
    await expect(modifier).toBeVisible();
    await expect(type).toBeVisible();
    await expect(variable).toBeVisible();
    const initialColors = await Promise.all(
      [modifier, type, variable].map((token) =>
        token.evaluate((element) => getComputedStyle(element).color)
      )
    );
    expect(new Set(initialColors).size).toBe(3);

    const geometry = await page.locator('.cm-source-editor').evaluate((editor) => {
      const gutter = editor.querySelector<HTMLElement>('.cm-gutters')!;
      return {
        gap: gutter.getBoundingClientRect().left - editor.getBoundingClientRect().left,
        gutterBackground: getComputedStyle(gutter).backgroundColor,
        editorBackground: getComputedStyle(editor).backgroundColor,
        borderWidth: getComputedStyle(gutter).borderRightWidth,
      };
    });
    expect(Math.abs(geometry.gap)).toBeLessThan(1);
    expect(geometry.gutterBackground).toBe(geometry.editorBackground);
    expect(geometry.borderWidth).toBe('0px');
    await page
      .locator('.cm-line')
      .filter({ hasText: 'private CombatSettingsSO _settings;' })
      .click();
    const activeNumber = page.locator('.cm-lineNumbers .cm-activeLineGutter');
    await expect(activeNumber).toHaveText('3');
    await expect(activeNumber).toHaveCSS('color', await rgb(page, 'var(--color-accent)'));
    await page.locator('.cm-lineNumbers .cm-gutterElement').filter({ hasText: /^5$/ }).click();
    await expect(activeNumber).toHaveText('5');

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await dialog.getByRole('button', { name: 'Edit colors', exact: true }).click();
    await dialog.getByRole('tab', { name: 'Code', exact: true }).click();
    const values =
      theme === 'dark'
        ? {
            'Keywords': '#e3e3e3',
            'Modifiers': '#ff6688',
            'Types': '#55bbff',
            'Variables / Parameters': '#bb99ff',
            'Strings / Characters': '#77cc66',
          }
        : {
            'Keywords': '#18181b',
            'Modifiers': '#9e1745',
            'Types': '#075985',
            'Variables / Parameters': '#6b21a8',
            'Strings / Characters': '#166534',
          };
    for (const [label, value] of Object.entries(values))
      await dialog
        .locator('.color-picker-item')
        .filter({ hasText: label })
        .locator('input[type="text"]')
        .fill(value);
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(modifier).toHaveCSS('color', await rgb(page, values['Modifiers']));
    await expect(type).toHaveCSS('color', await rgb(page, values['Types']));
    await expect(variable).toHaveCSS('color', await rgb(page, values['Variables / Parameters']));
    await expect(keyword).toHaveCSS('color', await rgb(page, values['Keywords']));
    await expect(page.locator('.editor-workspace .cm-token-string')).toHaveCSS(
      'color',
      await rgb(page, values['Strings / Characters'])
    );
    await dialog.getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page
      .locator('.cm-source-editor')
      .screenshot({ path: `test-results/code-colors-${theme}.png` });
  });

test('C# fences share the same modifier, custom type and variable roles', async ({ page }) => {
  await installWorkspaceMock(
    page,
    'dark',
    false,
    false,
    `# Code\n\n\`\`\`csharp\n${csharp}\n\`\`\`\n\nAfter code.`
  );
  await page.goto('/e2e/workspace.html');
  await expect(page.locator('.cm-codeblock-line .cm-token-modifier').first()).toBeVisible();
  await expect(
    page.locator('.cm-codeblock-line .cm-token-type').filter({ hasText: /^CombatSettingsSO$/ })
  ).toBeVisible();
  await expect(
    page
      .locator('.cm-codeblock-line .cm-token-variable')
      .filter({ hasText: /^_settings$/ })
      .first()
  ).toBeVisible();
  await page
    .locator('.cm-codeblock-language-header')
    .screenshot({ path: 'test-results/csharp-language-header.png' });
});
