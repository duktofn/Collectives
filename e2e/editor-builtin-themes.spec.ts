import { expect, test } from '@playwright/test';
import { installWorkspaceMock } from './helpers/workspaceMock';

test('reference themes apply to the frame, notes and code and remain read-only', async ({
  page,
}) => {
  await installWorkspaceMock(page, 'dark', false, false, undefined, undefined, {
    'Theme preview.md':
      '# Theme preview\n\nA focused workspace for notes and code.\n\n## Project notes\n\nRead, write and review at a comfortable contrast.\n\n### Next step\n\nKeep the important things visible.\n\n```rust\npub fn main() {\n  let count = 42;\n  println!("Hello {}", count);\n}\n```\n',
  });
  await page.goto('/e2e/workspace.html');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  for (const [name, mode] of [
    ['Pastel Dark', 'dark'],
    ['Pastel Light', 'light'],
    ['Cerulean', 'light'],
    ['Blues', 'dark'],
    ['Sicily', 'dark'],
    ['Ice & Butter', 'light'],
    ['Desert Nights', 'dark'],
    ['Viola', 'dark'],
    ['Luigi', 'dark'],
    ['Cove', 'dark'],
    ['Pinheiro', 'dark'],
    ['Holst', 'light'],
    ['Embers', 'dark'],
    ['Luna', 'dark'],
    ['Sunset', 'dark'],
    ['Violet Dusk', 'dark'],
    ['Ocean', 'dark'],
    ['Marple', 'dark'],
  ]) {
    await dialog.getByRole('combobox', { name: 'Theme', exact: true }).click();
    await dialog.getByRole('option', { name, exact: true }).click();
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
    await expect(dialog.getByRole('button', { name: 'Replace', exact: true })).toBeDisabled();
    await expect(page.locator('.app-shell-body')).toHaveCSS('border-top-width', '1px');
    await expect(page.locator('.app-shell-body')).not.toHaveCSS('box-shadow', 'none');
    if (name === 'Pinheiro') {
      const originalAccent = await dialog
        .getByLabel('Accent color hex', { exact: true })
        .inputValue();
      await dialog.getByLabel('Accent color hex', { exact: true }).fill('#ffffff');
      await dialog.getByRole('button', { name: 'Reset preset', exact: true }).click();
      await expect(dialog.getByLabel('Accent color hex', { exact: true })).toHaveValue(
        originalAccent
      );
    }
    const colors = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        surface: root.getPropertyValue('--bg-secondary').trim(),
        background: root.getPropertyValue('--bg-primary').trim(),
      };
    });
    await expect(page.locator('.window-titlebar')).toHaveCSS(
      'background-color',
      await page.evaluate((color) => {
        const probe = document.createElement('span');
        probe.style.color = color;
        document.body.append(probe);
        const rgb = getComputedStyle(probe).color;
        probe.remove();
        return rgb;
      }, colors.surface)
    );
    await dialog.screenshot({
      path: `test-results/preset-${name.toLowerCase().replaceAll(' ', '-')}.png`,
    });
    if (name === 'Embers' || name === 'Holst') {
      await dialog.getByRole('button', { name: 'Hide colors', exact: true }).click();
      await dialog.getByRole('combobox', { name: 'Theme', exact: true }).click();
      await page.screenshot({ path: `test-results/theme-picker-${name.toLowerCase()}.png` });
      await page.keyboard.press('Escape');
    }
    await dialog.getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.screenshot({
      path: `test-results/preset-${name.toLowerCase().replaceAll(' ', '-')}-workspace.png`,
    });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
  }
  await dialog.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.screenshot({ path: 'test-results/marple-window-frame.png' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await dialog.getByLabel('Theme name', { exact: true }).fill('Marple copy');
  await dialog.getByRole('button', { name: 'Save new', exact: true }).click();
  const duplicate = page.getByRole('dialog', { name: 'Matching colors', exact: true });
  await expect(duplicate).toContainText('Marple');
  await expect(
    duplicate.getByRole('button', { name: 'Replace existing', exact: true })
  ).toHaveCount(0);
});

test('window controls use native minimize, maximize, drag and close actions', async ({ page }) => {
  await installWorkspaceMock(page);
  await page.addInitScript(() => {
    const host = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
      };
      __windowCommands: string[];
    };
    const invoke = host.__TAURI_INTERNALS__.invoke;
    let maximized = false;
    host.__windowCommands = [];
    host.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command.startsWith('plugin:window|')) host.__windowCommands.push(command);
      if (command === 'plugin:window|toggle_maximize') {
        maximized = !maximized;
        return null;
      }
      if (command === 'plugin:window|is_maximized') return maximized;
      return invoke(command, args);
    };
  });
  await page.goto('/e2e/workspace.html');
  await page.getByRole('button', { name: 'Minimize window', exact: true }).click();
  await page.getByRole('button', { name: 'Maximize window', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restore window', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restore window', exact: true }).click();
  await page.locator('.window-drag-region').click();
  await page.locator('.window-drag-region').dblclick();
  await expect(page.getByRole('button', { name: 'Restore window', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close window', exact: true }).click();
  const commands = await page.evaluate(
    () => (window as unknown as { __windowCommands: string[] }).__windowCommands
  );
  expect(commands).toContain('plugin:window|minimize');
  expect(commands).toContain('plugin:window|toggle_maximize');
  expect(commands).toContain('plugin:window|start_dragging');
  expect(commands).toContain('plugin:window|close');
  expect(commands).not.toContain('plugin:window|destroy');
});
