import { expect, test, type Page } from '@playwright/test';
import { installWorkspaceMock } from './helpers/workspaceMock';

async function openNote(page: Page, text = '# Charts\n\nCreate a chart below.\n\n') {
  await installWorkspaceMock(page, 'dark', false, false, text);
  await page.goto('/e2e/workspace.html');
  await expect(page.locator('.cm-content')).toContainText('Charts');
  await page.evaluate(async () => {
    const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
    const view = viewForElement(document.querySelector('.cm-content') as HTMLElement)!;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.focus();
  });
}

async function expectChartData(page: Page, data: number[]) {
  await expect(page.locator('.cm-chart-widget-container')).toHaveAttribute(
    'data-chart-state',
    'ready'
  );
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const moduleUrl = performance
          .getEntriesByType('resource')
          .find((entry) => entry.name.includes('/chart__js_auto.js'))?.name;
        if (!moduleUrl) return null;
        const { default: Chart } = await import(/* @vite-ignore */ moduleUrl);
        const canvas = document.querySelector<HTMLCanvasElement>('.cm-chart-wrapper canvas');
        return canvas
          ? {
              data: Chart.getChart(canvas)?.data.datasets[0]?.data,
              instances: Object.keys(Chart.instances).length,
            }
          : null;
      })
    )
    .toEqual({ data, instances: 1 });
}

async function editChart(page: Page, tab: 'visual' | 'yaml' = 'yaml') {
  await page.locator('.cm-chart-widget-container').hover();
  await page.getByRole('button', { name: 'Chart actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit chart', exact: true });
  await expect(dialog).toBeVisible();
  if (tab === 'yaml') await dialog.getByRole('tab', { name: 'YAML', exact: true }).click();
  return dialog;
}

test('Insert chart creates a visible preview with sample data and an editable source', async ({
  page,
}) => {
  await openNote(page);
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Chart', exact: true }).click();
  await expect(page.locator('.cm-chart-widget-container')).toHaveCount(1);
  await expect(page.locator('.cm-chart-wrapper canvas')).toBeVisible();
  const source = await page.evaluate(async () => {
    const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
    return viewForElement(
      document.querySelector('.cm-content') as HTMLElement
    )!.state.doc.toString();
  });
  expect(source).toContain('```chart');
  expect(source).not.toContain('labels: []');
  expect(source).not.toContain('data: []');
  await expectChartData(page, [3, 7, 5]);
  // The editor caret must remain outside the chart's hidden Markdown source.
  await page.keyboard.type('Continue writing.');
  const after = await page.evaluate(async () => {
    const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
    return viewForElement(
      document.querySelector('.cm-content') as HTMLElement
    )!.state.doc.toString();
  });
  expect(after).toContain('```\n\nContinue writing.');
  await editChart(page);
  await expect(page.locator('.cm-chart-textarea')).toBeVisible();
});

test('typing /chart and Enter creates a chart rather than another template', async ({ page }) => {
  await openNote(page);
  await page.keyboard.type('/chart', { delay: 70 });
  await expect(page.getByRole('option').filter({ hasText: /^chart/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-chart-widget-container')).toHaveCount(1);
  await expectChartData(page, [3, 7, 5]);
});

test('an invalid chart shows the error and can be corrected before closing', async ({ page }) => {
  await openNote(page, '# Charts\n\n```chart\ntype: [broken\n```\n\nKeep this paragraph.');
  await expect(page.locator('.cm-chart-error')).toBeVisible();
  await editChart(page);
  await page
    .locator('.cm-chart-textarea')
    .fill(
      'type: bar\ndata:\n  labels: [A, B]\n  datasets:\n    - label: Example\n      data: [3, 7]'
    );
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.cm-chart-error')).toHaveCount(0);
  await expect(page.locator('.cm-chart-wrapper canvas')).toBeVisible();
  await expectChartData(page, [3, 7]);
  await expect(page.locator('.cm-content')).toContainText('Keep this paragraph.');
});

for (const fence of ['~~~', '````'])
  test(`chart source saves on close and preserves ${fence} fences and surrounding prose`, async ({
    page,
  }) => {
    await openNote(
      page,
      `# Charts\n\nBefore chart.\n\n${fence}chart\ntype: bar\ndata:\n  labels: [A]\n  datasets:\n    - data: [1]\n${fence}\n\nAfter chart.`
    );
    await expectChartData(page, [1]);
    await editChart(page);
    await page
      .locator('.cm-chart-textarea')
      .fill('type: bar\ndata:\n  labels: [A, B]\n  datasets:\n    - data: [2, 4]');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expectChartData(page, [2, 4]);
    const source = await page.evaluate(async () => {
      const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
      return viewForElement(
        document.querySelector('.cm-content') as HTMLElement
      )!.state.doc.toString();
    });
    expect(source).toContain(`Before chart.\n\n${fence}chart\n`);
    expect(source).toContain(`\n${fence}\n\nAfter chart.`);
  });

test('chart editing becomes available after switching Read back to Write', async ({ page }) => {
  await openNote(
    page,
    '# Charts\n\n```chart\ntype: bar\ndata:\n  labels: [A]\n  datasets:\n    - data: [1]\n```'
  );
  await expectChartData(page, [1]);
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Chart actions', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Write', exact: true }).click();
  await editChart(page);
  await expect(page.locator('.cm-chart-textarea')).toBeVisible();
});

test('chart is rendered when a long document finishes parsing near the viewport', async ({
  page,
}) => {
  await openNote(
    page,
    '# Charts\n\n' +
      'A paragraph in a long document.\n\n'.repeat(3000) +
      '```chart\ntype: bar\ndata:\n  labels: [A]\n  datasets:\n    - data: [8]\n```\n\nLast paragraph.'
  );
  await page.evaluate(async () => {
    const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const view = viewForElement(document.querySelector('.cm-content') as HTMLElement)!;
    view.dispatch({
      effects: EditorView.scrollIntoView(view.state.doc.toString().indexOf('```chart'), {
        y: 'center',
      }),
    });
  });
  await expectChartData(page, [8]);
});

test('a code language starting with chart is not treated as a chart', async ({ page }) => {
  await openNote(page, '# Charts\n\n```charting\nThis is a code sample.\n```\n\nAfter code.');
  await expect(page.locator('.cm-chart-widget-container')).toHaveCount(0);
  await expect(
    page.locator('.cm-codeblock-line').filter({ hasText: 'This is a code sample.' })
  ).toBeVisible();
});

test('saving resolves the current chart position after text is inserted before it', async ({
  page,
}) => {
  await openNote(
    page,
    '# Charts\n\nBefore chart.\n\n```chart\ntype: bar\ndata:\n  labels: [A]\n  datasets:\n    - data: [1]\n```\n\nAfter chart.'
  );
  await expectChartData(page, [1]);
  await page.evaluate(async () => {
    const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
    const view = viewForElement(document.querySelector('.cm-content') as HTMLElement)!;
    view.dispatch({ changes: { from: 0, insert: 'New content before the chart.\n\n' } });
  });
  await editChart(page);
  await page
    .locator('.cm-chart-textarea')
    .fill('type: bar\ndata:\n  labels: [A]\n  datasets:\n    - data: [9]');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expectChartData(page, [9]);
  const source = await page.evaluate(async () => {
    const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
    return viewForElement(
      document.querySelector('.cm-content') as HTMLElement
    )!.state.doc.toString();
  });
  expect(source.startsWith('New content before the chart.\n\n# Charts')).toBe(true);
  expect(source.endsWith('```\n\nAfter chart.')).toBe(true);
});

async function createChart(page: Page) {
  await openNote(page);
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Chart', exact: true }).click();
  await expectChartData(page, [3, 7, 5]);
}

async function setColor(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).evaluate((element, value) => {
    (element as HTMLInputElement).value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function chartSettings(page: Page) {
  return page.evaluate(async () => {
    const moduleUrl = performance
      .getEntriesByType('resource')
      .find((entry) => entry.name.includes('/chart__js_auto.js'))!.name;
    const { default: Chart } = await import(/* @vite-ignore */ moduleUrl);
    const chart = Chart.getChart(document.querySelector('.cm-chart-wrapper canvas'))!;
    return {
      type: chart.config.type,
      legendPosition: chart.options.plugins.legend.position,
      legendBelowPlot: chart.legend.top >= chart.chartArea.bottom,
      datasets: chart.data.datasets.map((dataset: any) => ({
        label: dataset.label,
        backgroundColor: dataset.backgroundColor,
        borderColor: dataset.borderColor,
        fill: dataset.fill,
      })),
    };
  });
}

for (const kind of ['pie', 'doughnut'])
  test(`${kind} legend sits on the right and moves below in a narrow container`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openNote(
      page,
      `# Charts\n\n\`\`\`chart\ntype: ${kind}\ndata:\n  labels: [A, B, C]\n  datasets:\n    - data: [3, 7, 5]\noptions:\n  animation: false\n\`\`\`\n\nAfter chart.`
    );
    await expectChartData(page, [3, 7, 5]);
    const widget = page.locator('.cm-chart-widget-container');
    const legend = widget.locator('.chart-percentage-legend');
    const plot = widget.locator('.cm-chart-wrapper');
    const layout = async () => {
      const legendBox = (await legend.boundingBox())!;
      const plotBox = (await plot.boundingBox())!;
      return {
        right: legendBox.x >= plotBox.x + plotBox.width + 10,
        below: legendBox.y >= plotBox.y + plotBox.height + 5,
      };
    };
    await expect.poll(layout).toEqual({ right: true, below: false });
    const buttons = await legend.locator('button').all();
    for (let index = 1; index < buttons.length; index++) {
      expect((await buttons[index].boundingBox())!.y).toBeGreaterThan(
        (await buttons[index - 1].boundingBox())!.y
      );
    }
    await widget.screenshot({ path: `test-results/chart-${kind}-legend-right.png` });

    // Use the chart's own width, so split panes and sidebars also trigger the fallback.
    await widget.evaluate((element) => {
      element.style.width = '330px';
    });
    await expect.poll(layout).toEqual({ right: false, below: true });
    await widget.evaluate((element) => {
      element.style.removeProperty('width');
    });
    await expect.poll(layout).toEqual({ right: true, below: false });

    const dialog = await editChart(page, 'visual');
    const previewPlot = (await dialog.locator('.chart-config-canvas').boundingBox())!;
    const previewLegend = dialog.locator('.chart-percentage-legend');
    await expect(previewLegend).toBeVisible();
    expect((await previewLegend.boundingBox())!.y).toBeGreaterThanOrEqual(
      previewPlot.y + previewPlot.height
    );
    await dialog.getByLabel('Show percentages', { exact: true }).uncheck();
    await expect(previewLegend.getByRole('button', { name: 'A', exact: true })).toBeVisible();
    await expect(previewLegend).not.toContainText('%');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(legend.getByRole('button', { name: 'A', exact: true })).toBeVisible();
    await expect.poll(layout).toEqual({ right: true, below: false });
  });

for (const kind of ['bar', 'line', 'area'])
  test(`${kind} keeps its legend below the wide plot`, async ({ page }) => {
    await openNote(
      page,
      `# Charts\n\n\`\`\`chart\ntype: ${kind}\ndata:\n  labels: [A, B, C]\n  datasets:\n    - label: Series\n      data: [3, 7, 5]\n\`\`\``
    );
    await expectChartData(page, [3, 7, 5]);
    expect(await chartSettings(page)).toMatchObject({
      legendPosition: 'bottom',
      legendBelowPlot: true,
    });
  });

test('visual pie editing saves slice colors and visible percentages', async ({ page }) => {
  await createChart(page);
  const dialog = await editChart(page, 'visual');
  await dialog.getByLabel('Chart type', { exact: true }).selectOption('pie');
  await dialog.getByLabel('Series value for row 1', { exact: true }).fill('25');
  await dialog.getByLabel('Series value for row 2', { exact: true }).fill('75');
  await dialog.getByRole('button', { name: 'Remove row 3', exact: true }).click();
  await setColor(page, 'Series color for row 1', '#ff0000');
  await setColor(page, 'Series color for row 2', '#0000ff');
  await expect(dialog.getByRole('button', { name: 'A: 25%', exact: true })).toBeVisible();
  await dialog.screenshot({ path: 'test-results/chart-gui-pie.png' });
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expectChartData(page, [25, 75]);
  expect(await chartSettings(page)).toMatchObject({
    type: 'pie',
    datasets: [{ backgroundColor: ['#ff0000', '#0000ff'] }],
  });
  await expect(page.getByRole('button', { name: 'A: 25%', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'B: 75%', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'A: 25%', exact: true }).click();
  await expect(page.getByRole('button', { name: 'B: 100%', exact: true })).toBeVisible();
});

for (const kind of ['line', 'area'])
  test(`visual ${kind} editing saves the color of each series`, async ({ page }) => {
    await createChart(page);
    const dialog = await editChart(page, 'visual');
    await dialog.getByLabel('Chart type', { exact: true }).selectOption(kind);
    await dialog.getByLabel('Series 1 name', { exact: true }).fill('Revenue');
    await setColor(page, 'Revenue color', '#118833');
    await dialog.getByRole('button', { name: 'Add series', exact: true }).click();
    await dialog.getByLabel('Series 2 name', { exact: true }).fill('Costs');
    await setColor(page, 'Costs color', '#aa33cc');
    await dialog.getByLabel('Costs value for row 1', { exact: true }).fill('6');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await chartSettings(page)).toMatchObject({
      type: 'line',
      datasets: [
        { label: 'Revenue', borderColor: '#118833', fill: kind === 'area' },
        { label: 'Costs', borderColor: '#aa33cc', fill: kind === 'area' },
      ],
    });
    const reopened = await editChart(page, 'visual');
    await expect(reopened.getByLabel('Chart type', { exact: true })).toHaveValue(kind);
    await reopened.getByRole('button', { name: 'Done', exact: true }).click();
  });

test('visual bar editing saves on close and discards an invalid draft', async ({ page }) => {
  await createChart(page);
  let dialog = await editChart(page, 'visual');
  await setColor(page, 'Series color for row 1', '#123456');
  await setColor(page, 'Series color for row 2', '#654321');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await chartSettings(page)).datasets[0].backgroundColor.slice(0, 2)).toEqual([
    '#123456',
    '#654321',
  ]);
  dialog = await editChart(page, 'visual');
  await dialog.getByLabel('Series value for row 1', { exact: true }).fill('');
  await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('alert')).toContainText('valid number');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expectChartData(page, [3, 7, 5]);
  await expect(page.locator('[data-app-shell-root]')).not.toHaveAttribute('inert');
});

test('the chart menu deletes one chart and Undo restores it', async ({ page }) => {
  await createChart(page);
  await page.locator('.cm-chart-widget-container').hover();
  await page.getByRole('button', { name: 'Chart actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.cm-chart-widget-container')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toContainText('Create a chart below.');
  await page.keyboard.press('Control+z');
  await expectChartData(page, [3, 7, 5]);
});

test('the chart editor fits a small light window and Escape restores focus', async ({ page }) => {
  await installWorkspaceMock(
    page,
    'light',
    false,
    false,
    '# Charts\n\n```chart\ntype: pie\ndata:\n  labels: [A, B]\n  datasets:\n    - data: [1, 3]\n```'
  );
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto('/e2e/workspace.html');
  await expectChartData(page, [1, 3]);
  const dialog = await editChart(page, 'visual');
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(800);
  expect(box!.y + box!.height).toBeLessThanOrEqual(600);
  await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'A: 25%', exact: true })).toBeVisible();
  await dialog.screenshot({ path: 'test-results/chart-gui-light.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Chart actions', exact: true })).toBeFocused();
  await expectChartData(page, [1, 3]);
});
