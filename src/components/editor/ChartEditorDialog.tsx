import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  Index,
  onCleanup,
  Show,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { render } from 'solid-js/web';
import type { Chart } from 'chart.js';
import { ModalLayer } from '../common/ModalLayer';
import { Icon } from '../common/Icon';
import {
  CHART_COLORS,
  chartDraftFromSource,
  colorForInput,
  configurationFromDraft,
  isPie,
  parseChartConfiguration,
  serializeChartConfiguration,
  type ChartConfigurationData,
  type ChartKind,
} from '../../lib/charts/chartModel';
import { chartPresentation } from '../../lib/charts/chartPresentation';
import './ChartEditorDialog.css';

interface ChartEditorProps {
  source: string;
  onSave: (source: string) => boolean;
  onClose: () => void;
}

export function ChartEditorDialog(props: ChartEditorProps) {
  let initial;
  let initialError = '';
  try {
    initial = chartDraftFromSource(props.source);
  } catch (error) {
    initialError = String(error instanceof Error ? error.message : error);
    initial = chartDraftFromSource('type: bar');
  }
  const [draft, setDraft] = createStore(initial);
  const initialDraftSignature = JSON.stringify(initial);
  const [tab, setTab] = createSignal<'visual' | 'yaml'>(initialError ? 'yaml' : 'visual');
  const [source, setSource] = createSignal(props.source);
  const [error, setError] = createSignal(initialError);
  const [previewError, setPreviewError] = createSignal('');
  const id = `chart-editor-${createUniqueId()}`;
  let canvas: HTMLCanvasElement | undefined;
  let legend: HTMLDivElement | undefined;
  let preview: Chart | undefined;
  let previewGeneration = 0;
  let disposed = false;
  const sliceColors = () => draft.kind === 'bar' || isPie(draft.kind);
  const configuration = createMemo<{ config: ChartConfigurationData | null; error: string }>(() => {
    try {
      return {
        config:
          tab() === 'yaml' ? parseChartConfiguration(source()) : configurationFromDraft(draft),
        error: '',
      };
    } catch (reason) {
      return { config: null, error: reason instanceof Error ? reason.message : String(reason) };
    }
  });

  createEffect(() => {
    const config = configuration().config;
    const generation = ++previewGeneration;
    setPreviewError('');
    const timer = setTimeout(async () => {
      if (disposed || generation !== previewGeneration) return;
      preview?.destroy();
      preview = undefined;
      if (!config || !canvas || !legend) return;
      try {
        const { default: ChartConstructor } = await import('chart.js/auto');
        if (disposed || generation !== previewGeneration) return;
        preview = new ChartConstructor(
          canvas,
          chartPresentation({ ...config, options: { ...config.options, animation: false } }, legend)
        );
      } catch (reason) {
        if (!disposed && generation === previewGeneration)
          setPreviewError(reason instanceof Error ? reason.message : String(reason));
      }
    }, 120);
    onCleanup(() => clearTimeout(timer));
  });
  onCleanup(() => {
    disposed = true;
    previewGeneration++;
    preview?.destroy();
  });

  const changeTab = (next: 'visual' | 'yaml') => {
    if (next === tab()) return;
    try {
      if (next === 'yaml') setSource(serializeChartConfiguration(configurationFromDraft(draft)));
      else setDraft(reconcile(chartDraftFromSource(source())));
      setError('');
      setTab(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const addRow = () =>
    batch(() => {
      const row = draft.labels.length;
      setDraft('labels', [...draft.labels, `Item ${row + 1}`]);
      draft.series.forEach((series, index) => {
        setDraft('series', index, 'values', [...series.values, '0']);
        setDraft('series', index, 'colors', [
          ...series.colors,
          CHART_COLORS[row % CHART_COLORS.length],
        ]);
      });
    });
  const removeRow = (row: number) =>
    batch(() => {
      setDraft(
        'labels',
        draft.labels.filter((_, index) => index !== row)
      );
      draft.series.forEach((series, index) => {
        setDraft(
          'series',
          index,
          'values',
          series.values.filter((_, i) => i !== row)
        );
        setDraft(
          'series',
          index,
          'colors',
          series.colors.filter((_, i) => i !== row)
        );
      });
    });
  const addSeries = () => {
    const index = draft.series.length;
    const fill = CHART_COLORS[index % CHART_COLORS.length];
    setDraft('series', [
      ...draft.series,
      {
        id: crypto.randomUUID(),
        name: `Series ${index + 1}`,
        color: fill,
        values: draft.labels.map(() => '0'),
        colors: draft.labels.map(() => fill),
        original: {},
      },
    ]);
  };
  const saveAndClose = () => {
    try {
      const config = configuration();
      const changed =
        tab() === 'yaml'
          ? source() !== props.source
          : JSON.stringify(draft) !== initialDraftSignature;
      if (config.config && changed) {
        const next = tab() === 'yaml' ? source() : serializeChartConfiguration(config.config);
        props.onSave(next);
      }
      props.onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <ModalLayer
      isOpen
      labelledBy={`${id}-title`}
      contentClass="chart-config-dialog"
      onClose={saveAndClose}
    >
      <div class="chart-config-header">
        <div>
          <h2 id={`${id}-title`}>Edit chart</h2>
          <p>Changes save automatically when you close this window.</p>
        </div>
        <button
          type="button"
          class="btn btn-text"
          aria-label="Close chart editor"
          onClick={saveAndClose}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      <div
        class="chart-config-tabs"
        role="tablist"
        aria-label="Chart editor"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          changeTab(
            event.key === 'Home'
              ? 'visual'
              : event.key === 'End'
                ? 'yaml'
                : tab() === 'visual'
                  ? 'yaml'
                  : 'visual'
          );
          document.getElementById(`${id}-${tab()}-tab`)?.focus();
        }}
      >
        <For each={['visual', 'yaml'] as const}>
          {(item) => (
            <button
              type="button"
              id={`${id}-${item}-tab`}
              role="tab"
              aria-selected={tab() === item}
              tabIndex={tab() === item ? 0 : -1}
              aria-controls={`${id}-panel`}
              onClick={() => changeTab(item)}
            >
              {item === 'visual' ? 'Chart settings' : 'YAML'}
            </button>
          )}
        </For>
      </div>
      <div class="chart-config-body">
        <section class="chart-config-preview" aria-label="Live chart preview">
          <div class="chart-presentation">
            <div class="chart-config-canvas">
              <canvas ref={canvas} role="img" aria-label="Chart preview" />
            </div>
            <div ref={legend} class="chart-percentage-legend" />
          </div>
        </section>
        <div class="chart-config-controls">
          <Show when={error() || configuration().error || previewError()}>
            <p class="chart-config-error" role="alert">
              {error() || configuration().error || previewError()}
            </p>
          </Show>
          <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab()}-tab`}>
            <Show
              when={tab() === 'visual'}
              fallback={
                <label class="chart-config-source-label">
                  Chart YAML
                  <textarea
                    class="cm-chart-textarea chart-config-source"
                    aria-label="Chart YAML"
                    value={source()}
                    onInput={(event) => {
                      setError('');
                      setSource(event.currentTarget.value);
                    }}
                    spellcheck={false}
                  />
                </label>
              }
            >
              <div class="chart-config-fields">
                <label>
                  Chart type
                  <select
                    aria-label="Chart type"
                    data-modal-initial-focus
                    value={draft.kind}
                    onChange={(event) => {
                      setError('');
                      setDraft('kind', event.currentTarget.value as ChartKind);
                    }}
                  >
                    <option value="bar">Bar</option>
                    <option value="line">Line</option>
                    <option value="area">Area</option>
                    <option value="pie">Pie</option>
                    <option value="doughnut">Doughnut</option>
                  </select>
                </label>
                <label>
                  Title
                  <input
                    value={draft.title}
                    onInput={(event) => setDraft('title', event.currentTarget.value)}
                    placeholder="Optional chart title"
                  />
                </label>
              </div>
              <div class="chart-config-toggles">
                <label>
                  <input
                    type="checkbox"
                    checked={draft.legend}
                    onChange={(event) => setDraft('legend', event.currentTarget.checked)}
                  />
                  Show legend
                </label>
                <Show when={isPie(draft.kind)}>
                  <label>
                    <input
                      type="checkbox"
                      checked={draft.percentages}
                      onChange={(event) => setDraft('percentages', event.currentTarget.checked)}
                    />
                    Show percentages
                  </label>
                </Show>
              </div>
              <div class="chart-config-section-title">
                <h3>Series</h3>
                <button type="button" class="btn btn-text" onClick={addSeries}>
                  Add series
                </button>
              </div>
              <div class="chart-config-series">
                <For each={draft.series}>
                  {(series, index) => (
                    <div class="chart-config-series-row">
                      <label>
                        Series {index() + 1}
                        <input
                          aria-label={`Series ${index() + 1} name`}
                          value={series.name}
                          onInput={(event) =>
                            setDraft('series', index(), 'name', event.currentTarget.value)
                          }
                        />
                      </label>
                      <Show when={!sliceColors()}>
                        <label class="chart-config-color">
                          Color
                          <input
                            type="color"
                            aria-label={`${series.name} color`}
                            value={colorForInput(series.color)}
                            onInput={(event) =>
                              setDraft('series', index(), 'color', event.currentTarget.value)
                            }
                          />
                        </label>
                      </Show>
                      <button
                        type="button"
                        class="btn btn-text"
                        aria-label={`Remove series ${index() + 1}`}
                        disabled={draft.series.length <= 1}
                        onClick={() =>
                          setDraft(
                            'series',
                            draft.series.filter((item) => item.id !== series.id)
                          )
                        }
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  )}
                </For>
              </div>
              <div class="chart-config-section-title">
                <h3>Data</h3>
                <button type="button" class="btn btn-text" onClick={addRow}>
                  Add row
                </button>
              </div>
              <div class="chart-config-data-scroll">
                <table class="chart-config-data">
                  <thead>
                    <tr>
                      <th>Label</th>
                      <For each={draft.series}>
                        {(series) => (
                          <>
                            <th>{series.name}</th>
                            <Show when={sliceColors()}>
                              <th>Color</th>
                            </Show>
                          </>
                        )}
                      </For>
                      <th>
                        <span class="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <Index each={draft.labels}>
                      {(label, row) => (
                        <tr>
                          <td>
                            <input
                              aria-label={`Row ${row + 1} label`}
                              value={label()}
                              onInput={(event) =>
                                setDraft('labels', row, event.currentTarget.value)
                              }
                            />
                          </td>
                          <For each={draft.series}>
                            {(series, seriesIndex) => (
                              <>
                                <td>
                                  <input
                                    type="number"
                                    step="any"
                                    aria-label={`${series.name} value for row ${row + 1}`}
                                    value={series.values[row] ?? ''}
                                    onInput={(event) =>
                                      setDraft(
                                        'series',
                                        seriesIndex(),
                                        'values',
                                        row,
                                        event.currentTarget.value
                                      )
                                    }
                                  />
                                </td>
                                <Show when={sliceColors()}>
                                  <td>
                                    <input
                                      type="color"
                                      aria-label={`${series.name} color for row ${row + 1}`}
                                      value={colorForInput(
                                        series.colors[row] ??
                                          CHART_COLORS[row % CHART_COLORS.length]
                                      )}
                                      onInput={(event) =>
                                        setDraft(
                                          'series',
                                          seriesIndex(),
                                          'colors',
                                          row,
                                          event.currentTarget.value
                                        )
                                      }
                                    />
                                  </td>
                                </Show>
                              </>
                            )}
                          </For>
                          <td>
                            <button
                              type="button"
                              class="btn btn-text"
                              aria-label={`Remove row ${row + 1}`}
                              disabled={draft.labels.length <= 1}
                              onClick={() => removeRow(row)}
                            >
                              <Icon name="trash" size={14} />
                            </button>
                          </td>
                        </tr>
                      )}
                    </Index>
                  </tbody>
                </table>
              </div>
            </Show>
          </div>
        </div>
      </div>
      <div class="chart-config-footer">
        <button type="button" class="btn btn-primary" onClick={saveAndClose}>
          Done
        </button>
      </div>
    </ModalLayer>
  );
}

export function openChartEditor(
  props: Omit<ChartEditorProps, 'onClose'>,
  onClosed: () => void = () => {}
): () => void {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let dispose = () => {};
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    dispose();
    host.remove();
    onClosed();
  };
  dispose = render(() => <ChartEditorDialog {...props} onClose={close} />, host);
  return close;
}
