import { describe, expect, it } from 'vitest';
import {
  chartDraftFromSource,
  configurationFromDraft,
  pieShares,
  serializeChartConfiguration,
} from './chartModel';

const source =
  'type: bar\ndata:\n  labels: [A, B]\n  datasets:\n    - label: Sales\n      data: [1, 3]\n      borderWidth: 2\noptions:\n  scales:\n    y:\n      beginAtZero: true\n  plugins:\n    tooltip:\n      enabled: false\n';

describe('visual chart configuration', () => {
  it('saves colors and values while preserving advanced settings', () => {
    const draft = chartDraftFromSource(source);
    draft.series[0].colors = ['#ff0000', '#0000ff'];
    draft.series[0].values = ['2', '6'];
    const config = configurationFromDraft(draft);
    expect(config.data.datasets[0]).toMatchObject({
      data: [2, 6],
      backgroundColor: ['#ff0000', '#0000ff'],
      borderWidth: 2,
    });
    expect(config.options.scales.y.beginAtZero).toBe(true);
    expect(config.options.plugins.tooltip.enabled).toBe(false);
    expect(chartDraftFromSource(serializeChartConfiguration(config)).series[0].colors).toEqual([
      '#ff0000',
      '#0000ff',
    ]);
  });

  it('maps area to a filled line and restores the area editor on reopen', () => {
    const draft = chartDraftFromSource(source);
    draft.kind = 'area';
    draft.series[0].color = '#118833';
    const config = configurationFromDraft(draft);
    expect(config.type).toBe('line');
    expect(config.data.datasets[0]).toMatchObject({ borderColor: '#118833', fill: true });
    expect(config.data.datasets[0].backgroundColor).toContain('0.25');
    expect(chartDraftFromSource(serializeChartConfiguration(config)).kind).toBe('area');
  });

  it('validates numbers and rejects negative pie slices without changing the source', () => {
    const draft = chartDraftFromSource(source);
    draft.series[0].values[0] = '';
    expect(() => configurationFromDraft(draft)).toThrow('valid number');
    draft.series[0].values[0] = '-2';
    expect(configurationFromDraft(draft).data.datasets[0].data[0]).toBe(-2);
    draft.kind = 'pie';
    expect(() => configurationFromDraft(draft)).toThrow('zero or positive');
    expect(draft.original.type).toBe('bar');
  });

  it('computes shares from visible positive slices and handles zero totals', () => {
    expect(pieShares([1, 3])).toEqual([25, 75]);
    expect(pieShares([1, 3], [false, true])).toEqual([0, 100]);
    expect(pieShares([0, 0])).toEqual([0, 0]);
  });

  it('keeps complex data in the YAML workflow', () => {
    expect(() =>
      chartDraftFromSource('type: line\ndata:\n  datasets:\n    - data: [{x: 1, y: 2}]')
    ).toThrow('YAML');
  });
});
