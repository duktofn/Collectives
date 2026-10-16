import type { Chart, ChartConfiguration, Plugin } from 'chart.js';
import { color } from 'chart.js/helpers';
import { isPie, percentageText, pieShares, type ChartConfigurationData } from './chartModel';

function distribution(chart: Chart, datasetIndex: number) {
  const dataset = chart.data.datasets[datasetIndex];
  const parsing = dataset.parsing ?? chart.options.parsing;
  const key =
    parsing && typeof parsing === 'object' && 'key' in parsing ? String(parsing.key) : 'value';
  const values = dataset.data.map((value) => {
    if (value && typeof value === 'object') {
      const parsed = key.split('.').reduce<any>((current, part) => current?.[part], value);
      return Number(parsed);
    }
    return Number(value);
  });
  return pieShares(
    values,
    values.map((_, index) => chart.getDataVisibility(index))
  );
}

export function chartPresentation(
  source: ChartConfigurationData,
  legend: HTMLElement
): ChartConfiguration {
  const config = JSON.parse(JSON.stringify(source));
  if (config.type === 'area') {
    config.type = 'line';
    config.data.datasets = config.data.datasets.map((dataset: any) => ({ ...dataset, fill: true }));
  }
  config.type ??= 'bar';
  config.data ??= { labels: [], datasets: [] };
  config.options = { responsive: true, maintainAspectRatio: false, ...config.options };
  config.options.plugins = {
    ...config.options.plugins,
    legend: { position: 'bottom', ...config.options.plugins?.legend },
  };
  legend.hidden = true;
  if (!isPie(config.type)) return config as ChartConfiguration;
  const showPercentages = config.collectives?.showPercentages !== false;
  const showLegend = config.options.plugins?.legend?.display !== false;
  config.options.plugins = {
    ...config.options.plugins,
    legend: { ...config.options.plugins?.legend, display: false },
  };
  let signature = '';
  const plugin: Plugin = {
    id: 'collectives-percentages',
    afterUpdate(chart) {
      legend.hidden = !showLegend;
      const items = chart.data.datasets.flatMap((dataset, datasetIndex) => {
        const shares = distribution(chart, datasetIndex);
        return (chart.data.labels ?? []).map((label, index) => ({
          name: `${chart.data.datasets.length > 1 ? `${dataset.label ?? `Series ${datasetIndex + 1}`} · ` : ''}${label}`,
          percentage: percentageText(shares[index] ?? 0),
          fill: String(
            (chart.getDatasetMeta(datasetIndex).data[index] as any)?.options?.backgroundColor ??
              '#64748b'
          ),
          visible: chart.getDataVisibility(index),
          index,
        }));
      });
      chart.canvas.setAttribute(
        'aria-label',
        `Pie chart. ${items.map((item) => (showPercentages ? `${item.name}: ${item.percentage}` : item.name)).join('; ')}`
      );
      const next = JSON.stringify(items);
      if (next === signature) return;
      signature = next;
      legend.replaceChildren();
      for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'chart-percentage-item';
        button.classList.toggle('is-hidden', !item.visible);
        button.setAttribute(
          'aria-label',
          showPercentages ? `${item.name}: ${item.percentage}` : item.name
        );
        button.setAttribute('aria-pressed', String(item.visible));
        const swatch = document.createElement('span');
        swatch.className = 'chart-percentage-swatch';
        swatch.style.background = item.fill;
        swatch.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.textContent = item.name;
        button.append(swatch, label);
        if (showPercentages) {
          const percentage = document.createElement('strong');
          percentage.textContent = item.percentage;
          button.appendChild(percentage);
        }
        button.onclick = () => {
          chart.toggleDataVisibility(item.index);
          chart.update();
        };
        legend.appendChild(button);
      }
    },
    afterDatasetsDraw(chart) {
      if (!showPercentages) return;
      chart.ctx.save();
      chart.ctx.font = '600 12px sans-serif';
      chart.ctx.textAlign = 'center';
      chart.ctx.textBaseline = 'middle';
      for (let datasetIndex = 0; datasetIndex < chart.data.datasets.length; datasetIndex++) {
        if (!chart.isDatasetVisible(datasetIndex)) continue;
        const shares = distribution(chart, datasetIndex);
        chart.getDatasetMeta(datasetIndex).data.forEach((element: any, index) => {
          if (!shares[index] || element.endAngle - element.startAngle < 0.2) return;
          const { x, y } = element.getCenterPoint();
          const fill = color(String(element.options.backgroundColor));
          const rgb = fill.rgb;
          const linear = (channel: number) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          };
          const luminance = fill.valid
            ? 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b)
            : 0;
          chart.ctx.fillStyle = luminance > 0.179 ? '#000000' : '#ffffff';
          chart.ctx.fillText(percentageText(shares[index]), x, y);
        });
      }
      chart.ctx.restore();
    },
  };
  return { ...config, plugins: [plugin] } as ChartConfiguration;
}
