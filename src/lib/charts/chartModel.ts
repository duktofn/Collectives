import * as yaml from 'js-yaml';
import { color } from 'chart.js/helpers';

export type ChartKind = 'bar' | 'line' | 'area' | 'pie' | 'doughnut';
export type ChartConfigurationData = Record<string, any>;
export const CHART_COLORS = [
  '#4f8ef7',
  '#f59e0b',
  '#10b981',
  '#ec4899',
  '#8b5cf6',
  '#06b6d4',
  '#ef4444',
];

export interface ChartSeriesDraft {
  id: string;
  name: string;
  values: string[];
  color: string;
  colors: string[];
  original: ChartConfigurationData;
}

export interface ChartDraft {
  kind: ChartKind;
  title: string;
  legend: boolean;
  percentages: boolean;
  labels: string[];
  series: ChartSeriesDraft[];
  original: ChartConfigurationData;
}

export function parseChartConfiguration(source: string): ChartConfigurationData {
  const parsed = yaml.load(source);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Chart source must define a configuration object.');
  }
  return parsed as ChartConfigurationData;
}

export function isPie(kind: string): boolean {
  return kind === 'pie' || kind === 'doughnut';
}

function clone(value: ChartConfigurationData): ChartConfigurationData {
  return JSON.parse(JSON.stringify(value));
}

export function colorForInput(value: string, fallback = CHART_COLORS[0]): string {
  const parsed = color(value);
  if (!parsed.valid) return fallback;
  const { r, g, b } = parsed.rgb;
  return '#' + [r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('');
}

function itemColor(value: unknown, index: number, fallback: string): string {
  const selected = Array.isArray(value) ? value[index % value.length] : value;
  return typeof selected === 'string' ? selected : fallback;
}

export function chartDraftFromSource(source: string): ChartDraft {
  const original = parseChartConfiguration(source);
  let kind = original.type ?? 'bar';
  if (!['bar', 'line', 'area', 'pie', 'doughnut'].includes(kind)) {
    throw new Error('This chart type can be edited in the YAML tab.');
  }
  const datasets = original.data?.datasets ?? [];
  const labels = original.data?.labels ?? [];
  if (
    !Array.isArray(datasets) ||
    !Array.isArray(labels) ||
    datasets.some(
      (dataset) =>
        !Array.isArray(dataset.data ?? []) ||
        (dataset.type && dataset.type !== (original.type ?? 'bar')) ||
        (dataset.data ?? []).some((value: unknown) => value !== null && typeof value === 'object')
    )
  ) {
    throw new Error('Use YAML for mixed chart types or object-based data.');
  }
  if (
    kind === 'line' &&
    datasets.some((dataset) => dataset.fill !== undefined && dataset.fill !== false)
  )
    kind = 'area';
  const length = Math.max(
    1,
    labels.length,
    ...datasets.map((dataset) => (dataset.data ?? []).length)
  );
  const draftLabels = Array.from({ length }, (_, index) =>
    String(labels[index] ?? `Item ${index + 1}`)
  );
  const series = (datasets.length ? datasets : [{ label: 'Series 1', data: [] }]).map(
    (dataset, index) => {
      const fallback = CHART_COLORS[index % CHART_COLORS.length];
      const seriesColor = itemColor(dataset.borderColor ?? dataset.backgroundColor, 0, fallback);
      return {
        id: `series-${index}`,
        name: String(dataset.label ?? `Series ${index + 1}`),
        values: draftLabels.map((_, row) => String(dataset.data?.[row] ?? 0)),
        color: seriesColor,
        colors: draftLabels.map((_, row) =>
          itemColor(dataset.backgroundColor, row, CHART_COLORS[row % CHART_COLORS.length])
        ),
        original: clone(dataset),
      };
    }
  );
  return {
    kind,
    title: String(original.options?.plugins?.title?.text ?? ''),
    legend: original.options?.plugins?.legend?.display !== false,
    percentages: original.collectives?.showPercentages !== false,
    labels: draftLabels,
    series,
    original: clone(original),
  };
}

export function configurationFromDraft(draft: ChartDraft): ChartConfigurationData {
  if (!draft.labels.length || !draft.series.length)
    throw new Error('Add at least one row and one series.');
  if (draft.labels.some((label) => !label.trim())) throw new Error('Enter a label for every row.');
  const config = clone(draft.original);
  config.type = draft.kind === 'area' ? 'line' : draft.kind;
  config.data = {
    ...config.data,
    labels: [...draft.labels],
    datasets: draft.series.map((series, index) => {
      const values = draft.labels.map((_, row) => {
        const raw = series.values[row] ?? '';
        const value = Number(raw);
        if (!raw.trim() || !Number.isFinite(value))
          throw new Error(
            `Enter a valid number for ${series.name || `series ${index + 1}`}, row ${row + 1}.`
          );
        if (isPie(draft.kind) && value < 0) throw new Error('Pie values must be zero or positive.');
        return value;
      });
      const dataset: ChartConfigurationData = {
        ...clone(series.original),
        label: series.name.trim() || `Series ${index + 1}`,
        data: values,
      };
      delete dataset.type;
      if (draft.kind === 'bar' || isPie(draft.kind)) {
        dataset.backgroundColor = draft.labels.map(
          (_, row) => series.colors[row] ?? CHART_COLORS[row % CHART_COLORS.length]
        );
        if (draft.kind === 'bar') dataset.borderColor = [...dataset.backgroundColor];
        delete dataset.fill;
      } else {
        dataset.borderColor = series.color;
        dataset.backgroundColor =
          draft.kind === 'area' ? color(series.color).alpha(0.25).rgbString() : series.color;
        dataset.pointBackgroundColor = series.color;
        dataset.fill =
          draft.kind === 'area'
            ? series.original.fill !== undefined && series.original.fill !== false
              ? series.original.fill
              : true
            : false;
      }
      return dataset;
    }),
  };
  config.options = {
    ...config.options,
    plugins: {
      ...config.options?.plugins,
      title: {
        ...config.options?.plugins?.title,
        display: !!draft.title.trim(),
        text: draft.title.trim(),
      },
      legend: { ...config.options?.plugins?.legend, display: draft.legend },
    },
  };
  if (isPie(draft.kind) && !isPie(draft.original.type)) delete config.options.scales;
  config.collectives = { ...config.collectives, showPercentages: draft.percentages };
  return config;
}

export function serializeChartConfiguration(config: ChartConfigurationData): string {
  return yaml.dump(config, { lineWidth: 100, noRefs: true });
}

export function pieShares(values: number[], visible: boolean[] = values.map(() => true)): number[] {
  const total = values.reduce(
    (sum, value, index) =>
      sum + (visible[index] && Number.isFinite(value) && value > 0 ? value : 0),
    0
  );
  return values.map((value, index) =>
    total > 0 && visible[index] && value > 0 ? (value / total) * 100 : 0
  );
}

export function percentageText(value: number): string {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`;
}
