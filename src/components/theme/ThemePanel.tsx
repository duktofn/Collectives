import { createSignal, Show, For, createUniqueId, onMount, onCleanup } from 'solid-js';
import { Settings, CustomFont, ImportedThemeFont } from '../../types';
import { Icon } from '../common/Icon';
import { Dialog } from '../common/Dialog';
import { ModalLayer } from '../common/ModalLayer';
import type { OperationLeaseRegistry } from '../../workflows/operationLease';
import * as settingsApi from '../../features/settings';
import {
  applyThemeSettings,
  registerCustomFonts,
  getDefaultThemeValues,
} from '../../lib/themeEngine';
import { ask, message, pickFontFile, saveThemeDialog, pickThemeFile } from '../../platform';
import './ThemePanel.css';
import { normalizeAccentColor } from '../../lib/themeColors';
import { ContentColorControls, ThemePaletteControls } from './AppearanceColors';
import { ThemeManager } from './ThemeManager';
import { SettingsSelect } from './SettingsSelect';
import { SettingsNumberInput } from './SettingsNumberInput';

interface ThemePanelProps {
  isOpen: boolean;
  isClosing?: boolean;
  onClose: () => void;
  settings: Settings;
  onSettingsChange: (newSettings: Settings) => void;
  operationLeaseRegistry?: OperationLeaseRegistry;
}

interface SettingsRecoveryDialogProps {
  isOpen: boolean;
  message: string;
  errorMessage?: string;
  pending?: boolean;
  onRecover: () => void | Promise<void>;
  onKeepFile: () => void;
}

export function SettingsRecoveryDialog(props: SettingsRecoveryDialogProps) {
  return (
    <Dialog
      isOpen={props.isOpen}
      title="Settings need recovery"
      type="confirm"
      message={`${props.message}\n\nThe existing file has not been changed. Resetting settings first saves an exact copy of that file for diagnosis.`}
      errorMessage={props.errorMessage}
      pending={props.pending}
      confirmLabel={props.pending ? 'Backing up…' : 'Back up and reset'}
      cancelLabel="Keep existing file"
      onConfirm={props.onRecover}
      onClose={props.onKeepFile}
    />
  );
}

function validateSettings(settings: Settings): string | null {
  if (!['dark', 'light', 'system'].includes(settings.theme))
    return 'Choose a supported theme mode.';
  if (settings.colorAccent && !normalizeAccentColor(settings.colorAccent))
    return 'Accent color must be a hex color, such as #7c3aed.';
  const numericValues = [
    ['Font scale', settings.fontScale],
    ['Line height', settings.lineHeight],
    ['H1 size', settings.sizeH1],
    ['H2 size', settings.sizeH2],
    ['H3 size', settings.sizeH3],
    ['H4 size', settings.sizeH4],
    ['Note width', settings.noteWidth],
  ] as const;
  for (const [label, value] of numericValues) {
    // Native optional settings are serialized as null; both null and undefined use defaults.
    if (value != null && (!Number.isFinite(value) || value <= 0))
      return `${label} must be a positive number.`;
  }
  const colorValues = [
    settings.colorBody,
    settings.colorH1,
    settings.colorH2,
    settings.colorH3,
    settings.colorH4,
    settings.colorCodeBg,
    settings.colorCodeText,
    settings.colorSelection,
    settings.colorLink,
    settings.colorLinkHover,
    ...Object.values(settings.codeColors ?? {}),
    ...Object.values(settings.themeColors ?? {}),
  ];
  for (const color of colorValues) {
    if (!color) continue;
    const probe = document.createElement('span');
    probe.style.color = '';
    probe.style.color = color;
    if (!probe.style.color) return `“${color}” is not a valid color.`;
  }
  if ((settings.customFonts ?? []).some((font) => !font.family.trim() || !font.fileName.trim())) {
    return 'Each custom font needs a family name and file.';
  }
  return null;
}

function stableSettingsKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSettingsKey).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item != null)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSettingsKey(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

export function ThemePanel(props: ThemePanelProps) {
  const titleId = `theme-panel-title-${createUniqueId()}`;
  const [activeSettingsTab, setActiveSettingsTab] = createSignal<
    'appearance' | 'behavior'
  >('appearance');
  const [appearanceSection, setAppearanceSection] = createSignal<'Theme' | 'Typography'>('Theme');
  const [baseline, setBaseline] = createSignal<Settings>({ ...props.settings });
  const [draft, setDraft] = createSignal<Settings>({ ...props.settings });
  const [isApplying, setIsApplying] = createSignal(false);
  const [applyError, setApplyError] = createSignal('');
  let sessionActive = true;
  const pendingFontSources = new Map<string, string>();
  const pendingThemeFonts = new Map<string, ImportedThemeFont>();
  onCleanup(() => {
    sessionActive = false;
  });

  const isDirty = () => stableSettingsKey(draft()) !== stableSettingsKey(baseline());
  const validationError = () => validateSettings(draft());
  // Local state for font import form
  const [isImporting, setIsImporting] = createSignal(false);
  const [importFilePath, setImportFilePath] = createSignal('');
  const [importFamily, setImportFamily] = createSignal('');
  const [importWeight, setImportWeight] = createSignal('400');
  const [importStyle, setImportStyle] = createSignal('normal');
  const [importError, setImportError] = createSignal('');
  const [isLongOperationPending, setIsLongOperationPending] = createSignal(false);

  const runLongOperation = async <T,>(label: string, operation: () => Promise<T>): Promise<T> => {
    setIsLongOperationPending(true);
    const lease = props.operationLeaseRegistry?.register(label);
    try {
      return await operation();
    } finally {
      lease?.release();
      setIsLongOperationPending(false);
    }
  };

  // Check if system is in dark mode
  const [systemIsDark, setSystemIsDark] = createSignal(false);

  onMount(() => {
    // Set up system dark mode listener
    if (typeof window.matchMedia === 'function') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      setSystemIsDark(mediaQuery.matches);

      const handleChange = (e: MediaQueryListEvent) => {
        setSystemIsDark(e.matches);
      };

      mediaQuery.addEventListener('change', handleChange);

      onCleanup(() => {
        mediaQuery.removeEventListener('change', handleChange);
      });
    }
  });

  const getEffectiveIsDark = () => {
    if (draft().theme === 'dark') return true;
    if (draft().theme === 'light') return false;
    return systemIsDark();
  };

  const defaults = () => getDefaultThemeValues(getEffectiveIsDark());

  const parseSizeValue = (val: string): number | undefined => {
    if (!val) return undefined;
    const normalized = val.replace(/,/g, '.');
    const parsed = parseFloat(normalized);
    return isNaN(parsed) ? undefined : parsed;
  };

  // Handle single property update
  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  // Reset to defaults
  const handleReset = () => {
    const resetSettings: Settings = {
      theme: 'dark',
      fontBody: undefined,
      fontMono: undefined,
      fontScale: 1.0,
      lineHeight: undefined,
      sizeH1: undefined,
      colorBody: undefined,
      colorAccent: undefined,
      codeColors: undefined,
      themeColors: undefined,
      customThemes: draft().customThemes,
      activeThemeId: undefined,
      sidebarHoverReveal: undefined,
      noteLayout: undefined,
      noteWidth: undefined,
      highlightCodeOccurrences: undefined,
      highlightMarkdownOccurrences: undefined,
      sizeH2: undefined,
      sizeH3: undefined,
      sizeH4: undefined,
      colorH1: undefined,
      colorH2: undefined,
      colorH3: undefined,
      colorH4: undefined,
      colorCodeBg: undefined,
      colorCodeText: undefined,
      colorSelection: undefined,
      colorLink: undefined,
      colorLinkHover: undefined,
      customFonts: draft().customFonts, // Keep custom fonts registered
    };
    setDraft(resetSettings);
  };

  // Font Picker Options
  const getBodyFonts = () => {
    const list = ['system-ui', 'Georgia', 'Arial'];
    const custom = draft().customFonts || [];
    const uniqueCustom = Array.from(new Set(custom.map((f) => f.family)));
    return Array.from(
      new Set([...list, ...uniqueCustom, ...(draft().fontBody ? [draft().fontBody!] : [])])
    );
  };

  const getMonoFonts = () => {
    const list = ['monospace', 'Consolas', 'Courier New'];
    const custom = draft().customFonts || [];
    const uniqueCustom = Array.from(new Set(custom.map((f) => f.family)));
    return Array.from(
      new Set([...list, ...uniqueCustom, ...(draft().fontMono ? [draft().fontMono!] : [])])
    );
  };

  // Import font handlers
  const handlePickFontFile = async () => {
    try {
      const selected = await pickFontFile('Select Font file');
      if (selected && sessionActive) {
        setImportFilePath(selected);
        // Autopopulate family name from file name
        const filename = selected.split(/[/\\]/).pop() || '';
        const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
        const formattedName = nameWithoutExt
          .replace(/[_-]/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());
        setImportFamily(formattedName.split(' ')[0] || 'CustomFont');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleConfirmImport = async () => {
    if (!importFilePath()) {
      setImportError('Please select a font file');
      return;
    }
    if (!importFamily().trim()) {
      setImportError('Family name cannot be empty');
      return;
    }

    setImportError('');
    try {
      const sourcePath = importFilePath();
      const extension = sourcePath.split('.').pop()?.toLowerCase() || 'ttf';
      const pendingName = `pending-${crypto.randomUUID()}.${extension}`;
      const newFont: CustomFont = {
        family: importFamily().trim(),
        fileName: pendingName,
        weight: importWeight(),
        style: importStyle(),
      };
      pendingFontSources.set(pendingName, sourcePath);
      setDraft((current) => ({
        ...current,
        customFonts: [...(current.customFonts ?? []), newFont],
      }));

      // Reset form
      setIsImporting(false);
      setImportFilePath('');
      setImportFamily('');
      setImportWeight('400');
      setImportStyle('normal');
    } catch (err) {
      setImportError(String(err) || 'Failed to import font file');
    }
  };

  const handleDeleteFont = async (font: CustomFont) => {
    const confirmed = await ask(
      `Are you sure you want to delete font ${font.family} (${font.weight}, ${font.style})?`,
      {
        title: 'Delete Font',
        kind: 'warning',
      }
    );
    if (!confirmed || !sessionActive) {
      return;
    }
    pendingFontSources.delete(font.fileName);
    setDraft((current) => ({
      ...current,
      customFonts: (current.customFonts ?? []).filter((item) => item.fileName !== font.fileName),
    }));
  };

  // Export Theme Handler
  const handleExportTheme = async () => {
    try {
      const destPath = await saveThemeDialog('Export Theme JSON');
      if (!destPath) return;

      await runLongOperation('Export theme', () =>
        settingsApi.exportTheme(props.settings, destPath)
      );
      await message('Theme exported successfully!', {
        title: 'Export Theme',
        kind: 'info',
      });
    } catch (err) {
      console.error(err);
      await message(`Export failed: ${err}`, {
        title: 'Export Theme Failed',
        kind: 'error',
      });
    }
  };

  // Import Theme Handler
  const handleImportTheme = async () => {
    try {
      const themePath = await pickThemeFile('Select Theme JSON to Import');
      if (!themePath) return;

      const importedTheme = await runLongOperation('Import theme', () =>
        settingsApi.importTheme(themePath)
      );
      if (!sessionActive) return;
      pendingFontSources.clear();
      pendingThemeFonts.clear();
      for (const font of importedTheme.fonts) pendingThemeFonts.set(font.fileName, font);
      const imported = importedTheme.settings;
      const themes = new Map((draft().customThemes ?? []).map((theme) => [theme.id, theme]));
      for (const theme of imported.customThemes ?? [])
        if (!themes.has(theme.id)) themes.set(theme.id, theme);
      setDraft({ ...imported, customThemes: themes.size ? [...themes.values()] : undefined });
    } catch (err) {
      console.error(err);
      await message(`Import failed: ${err}`, {
        title: 'Import Theme Failed',
        kind: 'error',
      });
    }
  };

  const handleApply = async () => {
    if (
      props.isClosing ||
      !isDirty() ||
      validationError() ||
      isApplying() ||
      isLongOperationPending()
    )
      return;
    setIsApplying(true);
    setApplyError('');
    const previousSettings = baseline();
    const stagedFonts: CustomFont[] = [];
    let committed = false;
    try {
      const fontsDir = await settingsApi.getFontsDir();
      const nextFonts: CustomFont[] = [];
      for (const font of draft().customFonts ?? []) {
        const sourcePath = pendingFontSources.get(font.fileName);
        const themeFont = pendingThemeFonts.get(font.fileName);
        if (sourcePath) {
          const staged = await settingsApi.importFont(
            sourcePath,
            font.family,
            font.weight,
            font.style
          );
          stagedFonts.push(staged);
          nextFonts.push(staged);
        } else if (themeFont) {
          const staged = await settingsApi.importFont(
            '',
            font.family,
            font.weight,
            font.style,
            themeFont.base64Data,
            themeFont.fileName
          );
          stagedFonts.push(staged);
          nextFonts.push(staged);
        } else {
          nextFonts.push(font);
        }
      }

      const savedSettings: Settings = {
        ...draft(),
        customFonts: nextFonts,
      };
      const invalid = validateSettings(savedSettings);
      if (invalid) throw new Error(invalid);

      await settingsApi.saveSettings(savedSettings);
      committed = true;
      props.onSettingsChange(savedSettings);
      setBaseline(savedSettings);
      setDraft(savedSettings);
      pendingFontSources.clear();
      pendingThemeFonts.clear();
      applyThemeSettings(savedSettings);
      registerCustomFonts(savedSettings.customFonts, fontsDir);

      const retainedFiles = new Set(nextFonts.map((font) => font.fileName));
      const removedFiles = (previousSettings.customFonts ?? []).filter(
        (font) => !retainedFiles.has(font.fileName)
      );
      for (const font of removedFiles) {
        try {
          await settingsApi.deleteFont(font.fileName);
        } catch (error) {
          console.warn('Could not remove an unused font file', error);
        }
      }
    } catch (error) {
      if (!committed) {
        await Promise.all(
          stagedFonts.map((font) => settingsApi.deleteFont(font.fileName).catch(() => {}))
        );
      }
      setApplyError(
        committed
          ? `Settings were saved, but the app could not finish refreshing them: ${String(error)}`
          : `Could not apply settings: ${String(error)}`
      );
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <ModalLayer
      pending={isApplying() || props.isClosing}
      isOpen={props.isOpen}
      labelledBy={titleId}
      overlayClass={`theme-panel-backdrop ${props.isClosing ? 'is-closing' : ''}`}
      contentClass={`theme-panel ${props.isClosing ? 'is-closing' : ''}`}
      onClose={props.onClose}
    >
      <div class="theme-panel-header">
        <h3 id={titleId}>Settings</h3>
        <button
          class="btn-close"
          aria-label="Close settings"
          disabled={isApplying() || props.isClosing}
          onClick={() => props.onClose()}
        >
          <Icon name="x" size={18} />
        </button>
      </div>

      <fieldset
        class="theme-panel-fields"
        disabled={isApplying() || isLongOperationPending() || props.isClosing}
      >
        <div class="theme-panel-tabs" role="tablist" aria-label="Settings categories">
          <button
            role="tab"
            id="settings-tab-appearance"
            aria-controls="settings-appearance-panel"
            aria-selected={activeSettingsTab() === 'appearance' ? 'true' : 'false'}
            classList={{ active: activeSettingsTab() === 'appearance' }}
            onClick={() => setActiveSettingsTab('appearance')}
          >
            Appearance
          </button>
          <button
            role="tab"
            id="settings-tab-behavior"
            aria-controls="settings-behavior-panel"
            aria-selected={activeSettingsTab() === 'behavior' ? 'true' : 'false'}
            classList={{ active: activeSettingsTab() === 'behavior' }}
            onClick={() => setActiveSettingsTab('behavior')}
          >
            Behavior
          </button>
        </div>
        <Show when={activeSettingsTab()} keyed>
          {(tab) => (
            <div
              id={`settings-${tab}-panel`}
              class="theme-panel-content settings-tab-panel"
              role="tabpanel"
              aria-labelledby={`settings-tab-${tab}`}
              aria-busy={isApplying() ? 'true' : 'false'}
            >
              <Show when={tab === 'appearance'}>
                <nav class="appearance-navigation" aria-label="Appearance sections">
                  <For each={['Theme', 'Typography'] as const}>
                    {(section) => (
                      <button
                        type="button"
                        aria-pressed={appearanceSection() === section}
                        onClick={() => setAppearanceSection(section)}
                      >
                        {section}
                      </button>
                    )}
                  </For>
                </nav>
                <Show when={appearanceSection()} keyed>
                  {(section) => (
                    <div class="settings-section-content">
                      <Show when={section === 'Theme'}>
                        <ThemeManager
                          settings={draft()}
                          dark={getEffectiveIsDark()}
                          onChange={setDraft}
                          error={validationError()}
                        >
                          {/* Section: Theme mode */}
                          <div class="theme-section">
                            <h4>Theme mode</h4>
                            <div class="theme-mode-options">
                              <button
                                disabled={isLongOperationPending()}
                                class={`mode-option-btn ${draft().theme === 'light' ? 'active' : ''}`}
                                onClick={() => updateSetting('theme', 'light')}
                              >
                                <Icon name="sun" size={14} /> Light
                              </button>
                              <button
                                disabled={isLongOperationPending()}
                                class={`mode-option-btn ${draft().theme === 'dark' ? 'active' : ''}`}
                                onClick={() => updateSetting('theme', 'dark')}
                              >
                                <Icon name="moon" size={14} /> Dark
                              </button>
                              <button
                                disabled={isLongOperationPending()}
                                class={`mode-option-btn ${draft().theme === 'system' ? 'active' : ''}`}
                                onClick={() => updateSetting('theme', 'system')}
                              >
                                <Icon name="monitor" size={14} /> System
                              </button>
                            </div>
                          </div>

                          <div class="theme-section">
                            <h4>Accent color</h4>
                            <div class="theme-accent-controls">
                              <div class="color-input-wrapper">
                                <input
                                  type="color"
                                  aria-label="Accent color picker"
                                  value={
                                    normalizeAccentColor(draft().colorAccent) ??
                                    defaults().colorAccent
                                  }
                                  onInput={(event) =>
                                    updateSetting('colorAccent', event.currentTarget.value)
                                  }
                                />
                                <input
                                  type="text"
                                  aria-label="Accent color hex"
                                  placeholder={defaults().colorAccent}
                                  value={draft().colorAccent ?? ''}
                                  onInput={(event) =>
                                    updateSetting(
                                      'colorAccent',
                                      event.currentTarget.value.trim() || undefined
                                    )
                                  }
                                  spellcheck={false}
                                />
                              </div>
                              <button
                                type="button"
                                class="btn btn-secondary"
                                disabled={!draft().colorAccent}
                                onClick={() => updateSetting('colorAccent', undefined)}
                              >
                                Use theme default
                              </button>
                            </div>
                            <p class="settings-local-first-note">
                              Used for buttons, highlights, and the active line number.
                            </p>
                          </div>

                          <ThemePaletteControls
                            settings={draft()}
                            dark={getEffectiveIsDark()}
                            defaults={defaults()}
                            onChange={setDraft}
                          />
                          <ContentColorControls
                            settings={draft()}
                            dark={getEffectiveIsDark()}
                            defaults={defaults()}
                            onChange={setDraft}
                          />
                        </ThemeManager>
                        <div class="theme-section">
                          <div class="theme-save-actions">
                            <button
                              type="button"
                              class="btn btn-secondary"
                              onClick={handleExportTheme}
                            >
                              Export theme
                            </button>
                            <button
                              type="button"
                              class="btn btn-secondary"
                              onClick={handleImportTheme}
                            >
                              Import theme
                            </button>
                          </div>
                        </div>
                      </Show>
                      <Show when={section === 'Typography'}>
                        {/* Section: Typography */}
                        <div class="theme-section">
                          <h4>Typography</h4>
                          <SettingsSelect
                            id="body-font"
                            label="Body font"
                            value={draft().fontBody ?? ''}
                            options={[
                              { value: '', label: 'System default' },
                              ...getBodyFonts().map((font) => ({ value: font, label: font })),
                            ]}
                            onChange={(value) => updateSetting('fontBody', value || undefined)}
                          />
                          <SettingsSelect
                            id="code-font"
                            label="Code font"
                            value={draft().fontMono ?? ''}
                            options={[
                              { value: '', label: 'System monospace' },
                              ...getMonoFonts().map((font) => ({ value: font, label: font })),
                            ]}
                            onChange={(value) => updateSetting('fontMono', value || undefined)}
                          />
                          <div class="form-row">
                            <SettingsNumberInput
                              id="line-height"
                              label="Line height"
                              value={draft().lineHeight ?? 1.6}
                              defaultValue={1.6}
                              min={0.1}
                              step={0.1}
                              onChange={(value) => updateSetting('lineHeight', value)}
                            />
                            <SettingsNumberInput
                              id="font-scale"
                              label="Font scale"
                              value={draft().fontScale}
                              defaultValue={1}
                              min={0.1}
                              step={0.05}
                              onChange={(value) => updateSetting('fontScale', value)}
                            />
                          </div>

                          <div class="heading-sizes-grid">
                            <div class="input-group-compact">
                              <label for="heading-size-1">H1 size (em)</label>
                              <input
                                id="heading-size-1"
                                type="text"
                                placeholder={(2.2 * draft().fontScale).toFixed(2)}
                                value={draft().sizeH1 || ''}
                                onChange={(e) =>
                                  updateSetting('sizeH1', parseSizeValue(e.currentTarget.value))
                                }
                              />
                            </div>
                            <div class="input-group-compact">
                              <label for="heading-size-2">H2 size (em)</label>
                              <input
                                id="heading-size-2"
                                type="text"
                                placeholder={(1.65 * draft().fontScale).toFixed(2)}
                                value={draft().sizeH2 || ''}
                                onChange={(e) =>
                                  updateSetting('sizeH2', parseSizeValue(e.currentTarget.value))
                                }
                              />
                            </div>
                            <div class="input-group-compact">
                              <label for="heading-size-3">H3 size (em)</label>
                              <input
                                id="heading-size-3"
                                type="text"
                                placeholder={(1.35 * draft().fontScale).toFixed(2)}
                                value={draft().sizeH3 || ''}
                                onChange={(e) =>
                                  updateSetting('sizeH3', parseSizeValue(e.currentTarget.value))
                                }
                              />
                            </div>
                            <div class="input-group-compact">
                              <label for="heading-size-4">H4 size (em)</label>
                              <input
                                id="heading-size-4"
                                type="text"
                                placeholder={(1.15 * draft().fontScale).toFixed(2)}
                                value={draft().sizeH4 || ''}
                                onChange={(e) =>
                                  updateSetting('sizeH4', parseSizeValue(e.currentTarget.value))
                                }
                              />
                            </div>
                          </div>
                        </div>

                        {/* Section: Custom fonts */}
                        <div class="theme-section">
                          <div
                            style={{
                              display: 'flex',
                              'justify-content': 'space-between',
                              'align-items': 'center',
                              'margin-bottom': '8px',
                            }}
                          >
                            <h4>Custom fonts</h4>
                            <button
                              disabled={isLongOperationPending()}
                              class="btn btn-secondary btn-compact"
                              onClick={() => setIsImporting(!isImporting())}
                            >
                              <Icon name="plus" size={12} /> {isImporting() ? 'Cancel' : 'Add font'}
                            </button>
                          </div>

                          <Show when={isImporting()}>
                            <div class="import-font-form">
                              <h5>Import custom font</h5>
                              {importError() && <div class="import-error">{importError()}</div>}

                              <div class="input-group">
                                <label for="font-file">Font file</label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <input
                                    type="text"
                                    id="font-file"
                                    readonly
                                    placeholder="Select .ttf, .otf, .woff, .woff2"
                                    value={
                                      importFilePath()
                                        ? importFilePath().split(/[/\\]/).pop() || ''
                                        : ''
                                    }
                                  />
                                  <button class="btn btn-secondary" onClick={handlePickFontFile}>
                                    Browse
                                  </button>
                                </div>
                              </div>

                              <div class="input-group">
                                <label for="font-family-name">Family name</label>
                                <input
                                  type="text"
                                  id="font-family-name"
                                  placeholder="e.g. Fira Sans"
                                  value={importFamily()}
                                  onInput={(e) => setImportFamily(e.currentTarget.value)}
                                />
                              </div>

                              <div class="form-row">
                                <SettingsSelect
                                  id="font-weight"
                                  label="Weight"
                                  value={importWeight()}
                                  options={[
                                    { value: '300', label: 'Light (300)' },
                                    { value: '400', label: 'Regular (400)' },
                                    { value: '700', label: 'Bold (700)' },
                                    { value: '900', label: 'Black (900)' },
                                  ]}
                                  onChange={setImportWeight}
                                />
                                <SettingsSelect
                                  id="font-style"
                                  label="Style"
                                  value={importStyle()}
                                  options={[
                                    { value: 'normal', label: 'Normal' },
                                    { value: 'italic', label: 'Italic' },
                                  ]}
                                  onChange={setImportStyle}
                                />
                              </div>

                              <button
                                class="btn btn-primary btn-full"
                                onClick={handleConfirmImport}
                              >
                                Import font
                              </button>
                            </div>
                          </Show>

                          <div class="fonts-list">
                            <Show
                              when={(draft().customFonts?.length ?? 0) > 0}
                              fallback={<div class="fonts-empty">No custom fonts imported.</div>}
                            >
                              <For each={draft().customFonts ?? []}>
                                {(font) => (
                                  <div class="font-item">
                                    <div class="font-info">
                                      <span class="font-name">{font.family}</span>
                                      <span class="font-meta">
                                        {font.weight} / {font.style}
                                      </span>
                                    </div>
                                    <button
                                      class="btn-delete-font"
                                      onClick={() => handleDeleteFont(font)}
                                    >
                                      <Icon name="trash" size={14} />
                                    </button>
                                  </div>
                                )}
                              </For>
                            </Show>
                          </div>
                        </div>
                      </Show>
                    </div>
                  )}
                </Show>
              </Show>
              <Show when={tab === 'behavior'}>
                <div class="settings-section-content">
                  <div class="theme-section">
                    <h4>Note layout</h4>
                    <SettingsSelect
                      id="note-layout"
                      label="Layout"
                      value={draft().noteLayout ?? 'centered'}
                      options={[
                        { value: 'centered', label: 'Centered column' },
                        { value: 'wide', label: 'Full width' },
                      ]}
                      onChange={(value) =>
                        updateSetting('noteLayout', value as 'centered' | 'wide')
                      }
                    />
                    <Show when={(draft().noteLayout ?? 'centered') === 'centered'}>
                      <div class="input-group">
                        <label for="note-width">Column width · {draft().noteWidth ?? 760}px</label>
                        <input
                          id="note-width"
                          type="range"
                          min="480"
                          max="1200"
                          step="40"
                          value={draft().noteWidth ?? 760}
                          onInput={(event) =>
                            updateSetting('noteWidth', Number(event.currentTarget.value))
                          }
                        />
                      </div>
                    </Show>
                  </div>
                  <div class="theme-section">
                    <h4>Sidebar</h4>
                    <label class="settings-checkbox">
                      <input
                        type="checkbox"
                        checked={draft().sidebarHoverReveal ?? true}
                        onChange={(event) =>
                          updateSetting('sidebarHoverReveal', event.currentTarget.checked)
                        }
                      />
                      Reveal hidden sidebar on hover
                    </label>
                    <p class="appearance-description">
                      Move to the left edge to reveal it temporarily. Move away to hide it, or pin
                      it to keep it open.
                    </p>
                    <h4>Word highlights</h4>
                    <p class="appearance-description">
                      Highlight matching whole words when you place the cursor on a word.
                    </p>
                    <label class="settings-checkbox">
                      <input
                        type="checkbox"
                        checked={draft().highlightCodeOccurrences ?? true}
                        onChange={(event) =>
                          updateSetting('highlightCodeOccurrences', event.currentTarget.checked)
                        }
                      />
                      Code
                    </label>
                    <label class="settings-checkbox">
                      <input
                        type="checkbox"
                        checked={draft().highlightMarkdownOccurrences ?? true}
                        onChange={(event) =>
                          updateSetting('highlightMarkdownOccurrences', event.currentTarget.checked)
                        }
                      />
                      Markdown
                    </label>
                  </div>
                </div>
              </Show>
              <button
                type="button"
                class="btn btn-secondary btn-full appearance-reset-all"
                onClick={handleReset}
              >
                Reset to default settings
              </button>
            </div>
          )}
        </Show>
      </fieldset>
      <div class="theme-panel-footer">
        <Show when={applyError()}>
          <div class="apply-error" role="alert">
            {applyError()}
          </div>
        </Show>
        <Show when={validationError() && isDirty()}>
          <div class="apply-error" role="status">
            {validationError()}
          </div>
        </Show>
        <div class="theme-panel-footer-actions">
          <button
            class="btn btn-secondary"
            disabled={isApplying() || props.isClosing}
            onClick={() => props.onClose()}
          >
            Cancel
          </button>
          <button
            class="btn btn-primary"
            disabled={
              props.isClosing ||
              !isDirty() ||
              Boolean(validationError()) ||
              isApplying() ||
              isLongOperationPending()
            }
            onClick={handleApply}
          >
            {isApplying() ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </ModalLayer>
  );
}
