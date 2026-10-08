import { createSignal, Show, For, createUniqueId, onMount, onCleanup } from "solid-js";
import { Settings, CustomFont, ImportedThemeFont } from "../../types";
import { Icon } from "../common/Icon";
import { ModalLayer } from "../common/ModalLayer";
import { FileVisibilityPreference } from "./FileVisibilityPreference";
import type { OperationLeaseRegistry } from "../../workflows/operationLease";
import * as settingsApi from "../../features/settings";
import { applyThemeSettings, registerCustomFonts, getDefaultThemeValues } from "../../lib/themeEngine";
import { ask, message, pickFontFile, saveThemeDialog, pickThemeFile } from "../../platform";
import { uiStore } from "../../stores/ui";
import "./ThemePanel.css";

interface ThemePanelProps {
  isOpen: boolean;
  isClosing?: boolean;
  onClose: () => void;
  settings: Settings;
  onSettingsChange: (newSettings: Settings) => void;
  operationLeaseRegistry?: OperationLeaseRegistry;
}

function validateSettings(settings: Settings): string | null {
  if (!["dark", "light", "system"].includes(settings.theme)) return "Choose a supported theme mode.";
  const numericValues = [
    ["Font scale", settings.fontScale],
    ["Line height", settings.lineHeight],
    ["H1 size", settings.sizeH1],
    ["H2 size", settings.sizeH2],
    ["H3 size", settings.sizeH3],
    ["H4 size", settings.sizeH4],
  ] as const;
  for (const [label, value] of numericValues) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) return `${label} must be a positive number.`;
  }
  const colorValues = [
    settings.colorBody, settings.colorH1, settings.colorH2, settings.colorH3, settings.colorH4,
    settings.colorCodeBg, settings.colorCodeText, settings.colorSelection, settings.colorLink, settings.colorLinkHover,
  ];
  for (const color of colorValues) {
    if (!color) continue;
    const probe = document.createElement("span");
    probe.style.color = "";
    probe.style.color = color;
    if (!probe.style.color) return `“${color}” is not a valid color.`;
  }
  if ((settings.customFonts ?? []).some((font) => !font.family.trim() || !font.fileName.trim())) {
    return "Each custom font needs a family name and file.";
  }
  return null;
}

function stableSettingsKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSettingsKey).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSettingsKey(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export function ThemePanel(props: ThemePanelProps) {
  const titleId = `theme-panel-title-${createUniqueId()}`;
  const [activeSettingsTab, setActiveSettingsTab] = createSignal<"appearance" | "files" | "shortcuts">("appearance");
  const [showAdvancedColors, setShowAdvancedColors] = createSignal(false);
  const [baseline, setBaseline] = createSignal<Settings>({ ...props.settings });
  const [draft, setDraft] = createSignal<Settings>({ ...props.settings });
  const [isApplying, setIsApplying] = createSignal(false);
  const [applyError, setApplyError] = createSignal("");
  let sessionActive = true;
  const pendingFontSources = new Map<string, string>();
  const pendingThemeFonts = new Map<string, ImportedThemeFont>();
  onCleanup(() => { sessionActive = false; });

  const isDirty = () => stableSettingsKey(draft()) !== stableSettingsKey(baseline());
  const validationError = () => validateSettings(draft());
  // Local state for font import form
  const [isImporting, setIsImporting] = createSignal(false);
  const [importFilePath, setImportFilePath] = createSignal("");
  const [importFamily, setImportFamily] = createSignal("");
  const [importWeight, setImportWeight] = createSignal("400");
  const [importStyle, setImportStyle] = createSignal("normal");
  const [importError, setImportError] = createSignal("");
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
    if (typeof window.matchMedia === "function") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      setSystemIsDark(mediaQuery.matches);
      
      const handleChange = (e: MediaQueryListEvent) => {
        setSystemIsDark(e.matches);
      };
      
      mediaQuery.addEventListener("change", handleChange);
      
      onCleanup(() => {
        mediaQuery.removeEventListener("change", handleChange);
      });
    }
  });

  const getEffectiveIsDark = () => {
    if (draft().theme === "dark") return true;
    if (draft().theme === "light") return false;
    return systemIsDark();
  };

  const defaults = () => getDefaultThemeValues(getEffectiveIsDark());

  const parseSizeValue = (val: string): number | undefined => {
    if (!val) return undefined;
    const normalized = val.replace(/,/g, ".");
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
      theme: "dark",
      fontBody: undefined,
      fontMono: undefined,
      fontScale: 1.0,
      lineHeight: undefined,
      sizeH1: undefined,
      colorBody: undefined,
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
      hideUnsupportedFiles: draft().hideUnsupportedFiles,
      customFonts: draft().customFonts, // Keep custom fonts registered
    };
    setDraft(resetSettings);
  };

  // Font Picker Options
  const getBodyFonts = () => {
    const list = ["system-ui", "Georgia", "Arial"];
    const custom = draft().customFonts || [];
    const uniqueCustom = Array.from(new Set(custom.map(f => f.family)));
    return Array.from(new Set([...list, ...uniqueCustom, ...(draft().fontBody ? [draft().fontBody!] : [])]));
  };

  const getMonoFonts = () => {
    const list = ["monospace", "Consolas", "Courier New"];
    const custom = draft().customFonts || [];
    const uniqueCustom = Array.from(new Set(custom.map(f => f.family)));
    return Array.from(new Set([...list, ...uniqueCustom, ...(draft().fontMono ? [draft().fontMono!] : [])]));
  };

  // Import font handlers
  const handlePickFontFile = async () => {
    try {
      const selected = await pickFontFile("Select Font File");
      if (selected && sessionActive) {
        setImportFilePath(selected);
        // Autopopulate family name from file name
        const filename = selected.split(/[/\\]/).pop() || "";
        const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
        const formattedName = nameWithoutExt
          .replace(/[_-]/g, " ")
          .replace(/\b\w/g, c => c.toUpperCase());
        setImportFamily(formattedName.split(" ")[0] || "CustomFont");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleConfirmImport = async () => {
    if (!importFilePath()) {
      setImportError("Please select a font file");
      return;
    }
    if (!importFamily().trim()) {
      setImportError("Family name cannot be empty");
      return;
    }

    setImportError("");
    try {
      const sourcePath = importFilePath();
      const extension = sourcePath.split(".").pop()?.toLowerCase() || "ttf";
      const pendingName = `pending-${crypto.randomUUID()}.${extension}`;
      const newFont: CustomFont = {
        family: importFamily().trim(),
        fileName: pendingName,
        weight: importWeight(),
        style: importStyle(),
      };
      pendingFontSources.set(pendingName, sourcePath);
      setDraft((current) => ({ ...current, customFonts: [...(current.customFonts ?? []), newFont] }));

      // Reset form
      setIsImporting(false);
      setImportFilePath("");
      setImportFamily("");
      setImportWeight("400");
      setImportStyle("normal");
    } catch (err) {
      setImportError(String(err) || "Failed to import font file");
    }
  };

  const handleDeleteFont = async (font: CustomFont) => {
    const confirmed = await ask(`Are you sure you want to delete font ${font.family} (${font.weight}, ${font.style})?`, {
      title: "Delete Font",
      kind: "warning",
    });
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
      const destPath = await saveThemeDialog("Export Theme JSON");
      if (!destPath) return;

      await runLongOperation("Export theme", () => settingsApi.exportTheme(props.settings, destPath));
      await message("Theme exported successfully!", {
        title: "Export Theme",
        kind: "info",
      });
    } catch (err) {
      console.error(err);
      await message(`Export failed: ${err}`, {
        title: "Export Theme Failed",
        kind: "error",
      });
    }
  };

  // Import Theme Handler
  const handleImportTheme = async () => {
    try {
      const themePath = await pickThemeFile("Select Theme JSON to Import");
      if (!themePath) return;

      const importedTheme = await runLongOperation("Import theme", () => settingsApi.importTheme(themePath));
      if (!sessionActive) return;
      pendingFontSources.clear();
      pendingThemeFonts.clear();
      for (const font of importedTheme.fonts) pendingThemeFonts.set(font.fileName, font);
      setDraft(importedTheme.settings);
    } catch (err) {
      console.error(err);
      await message(`Import failed: ${err}`, {
        title: "Import Theme Failed",
        kind: "error",
      });
    }
  };

  const handleApply = async () => {
    if (props.isClosing || !isDirty() || validationError() || isApplying() || isLongOperationPending()) return;
    setIsApplying(true);
    setApplyError("");
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
          const staged = await settingsApi.importFont(sourcePath, font.family, font.weight, font.style);
          stagedFonts.push(staged);
          nextFonts.push(staged);
        } else if (themeFont) {
          const staged = await settingsApi.importFont(
            "", font.family, font.weight, font.style, themeFont.base64Data, themeFont.fileName,
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
        hideUnsupportedFiles: draft().hideUnsupportedFiles ?? previousSettings.hideUnsupportedFiles ?? uiStore.state.hideUnsupportedFiles,
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
      uiStore.setHideUnsupportedFiles(Boolean(savedSettings.hideUnsupportedFiles));
      applyThemeSettings(savedSettings);
      registerCustomFonts(savedSettings.customFonts, fontsDir);

      const retainedFiles = new Set(nextFonts.map((font) => font.fileName));
      const removedFiles = (previousSettings.customFonts ?? []).filter((font) => !retainedFiles.has(font.fileName));
      for (const font of removedFiles) {
        try { await settingsApi.deleteFont(font.fileName); }
        catch (error) { console.warn("Could not remove an unused font file", error); }
      }
    } catch (error) {
      if (!committed) {
        await Promise.all(stagedFonts.map((font) => settingsApi.deleteFont(font.fileName).catch(() => {})));
      }
      setApplyError(committed
        ? `Settings were saved, but the app could not finish refreshing them: ${String(error)}`
        : `Could not apply settings: ${String(error)}`);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <ModalLayer
      pending={isApplying() || props.isClosing}
      isOpen={props.isOpen}
      labelledBy={titleId}
      overlayClass={`theme-panel-backdrop ${props.isClosing ? "is-closing" : ""}`}
      contentClass={`theme-panel ${props.isClosing ? "is-closing" : ""}`}
      onClose={props.onClose}
    >
        <div class="theme-panel-header">
          <h3 id={titleId}>Settings</h3>
          <button class="btn-close" aria-label="Close settings" disabled={isApplying() || props.isClosing} onClick={() => props.onClose()}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <fieldset class="theme-panel-fields" disabled={isApplying() || isLongOperationPending() || props.isClosing}>
        <div class="theme-panel-tabs" role="tablist" aria-label="Settings categories">
          <button role="tab" aria-controls="settings-appearance-panel" aria-selected={activeSettingsTab() === "appearance" ? "true" : "false"} classList={{ active: activeSettingsTab() === "appearance" }} onClick={() => setActiveSettingsTab("appearance")}>Appearance</button>
          <button role="tab" aria-controls="settings-files-panel" aria-selected={activeSettingsTab() === "files" ? "true" : "false"} classList={{ active: activeSettingsTab() === "files" }} onClick={() => setActiveSettingsTab("files")}>Files & Storage</button>
          <button role="tab" aria-controls="settings-shortcuts-panel" aria-selected={activeSettingsTab() === "shortcuts" ? "true" : "false"} classList={{ active: activeSettingsTab() === "shortcuts" }} onClick={() => setActiveSettingsTab("shortcuts")}>Shortcuts</button>
        </div>
        <Show when={activeSettingsTab() === "files"}>
          <div id="settings-files-panel" class="theme-panel-content settings-tab-panel" role="tabpanel" aria-busy={isApplying() ? "true" : "false"}>
            <h4>Files & Storage</h4>
            <FileVisibilityPreference
              checked={draft().hideUnsupportedFiles ?? uiStore.state.hideUnsupportedFiles}
              onChange={(hidden) => updateSetting("hideUnsupportedFiles", hidden)}
            />
            <p class="settings-local-first-note">Notes stay in the folders you choose. Collection groups only organize references inside Collectives.</p>
          </div>
        </Show>
        <Show when={activeSettingsTab() === "shortcuts"}>
          <div id="settings-shortcuts-panel" class="theme-panel-content settings-tab-panel" role="tabpanel">
            <h4>Keyboard shortcuts</h4>
            <dl class="settings-shortcut-list">
              <div><dt><kbd>Ctrl/⌘ N</kbd></dt><dd>Create a note. Review or change its save folder before creating.</dd></div>
              <div><dt><kbd>Ctrl/⌘ P</kbd></dt><dd>Open a note by name in the active collection.</dd></div>
              <div><dt><kbd>Ctrl/⌘ Shift F</kbd></dt><dd>Search Markdown note contents in the active collection.</dd></div>
              <div><dt><kbd>Ctrl/⌘ S</kbd></dt><dd>Save the current draft.</dd></div>
              <div><dt><kbd>Alt ←</kbd></dt><dd>Go back when focus is outside an editor or text field.</dd></div>
              <div><dt><kbd>Alt →</kbd></dt><dd>Go forward when focus is outside an editor or text field.</dd></div>
            </dl>
          </div>
        </Show>
        <Show when={activeSettingsTab() === "appearance"}>
        <div id="settings-appearance-panel" class="theme-panel-content" role="tabpanel" aria-busy={isApplying() ? "true" : "false"}>
          {/* Section: Theme Mode */}
          <div class="theme-section">
            <h4>Theme Mode</h4>
            <div class="theme-mode-options">
              <button disabled={isLongOperationPending()}
                class={`mode-option-btn ${draft().theme === "light" ? "active" : ""}`}
                onClick={() => updateSetting("theme", "light")}
              >
                <Icon name="sun" size={14} /> Light
              </button>
              <button disabled={isLongOperationPending()}
                class={`mode-option-btn ${draft().theme === "dark" ? "active" : ""}`}
                onClick={() => updateSetting("theme", "dark")}
              >
                <Icon name="moon" size={14} /> Dark
              </button>
              <button disabled={isLongOperationPending()}
                class={`mode-option-btn ${draft().theme === "system" ? "active" : ""}`}
                onClick={() => updateSetting("theme", "system")}
              >
                <Icon name="monitor" size={14} /> System
              </button>
            </div>
          </div>

          {/* Section: Typography */}
          <div class="theme-section">
            <h4>Typography</h4>
            
            <div class="input-group">
              <label>Body Font Family</label>
              <select 
                value={draft().fontBody || ""}
                onChange={(e) => updateSetting("fontBody", e.currentTarget.value || undefined)}
              >
                <option value="">System default</option>
                <For each={getBodyFonts()}>
                  {(font) => <option value={font}>{font}</option>}
                </For>
              </select>
            </div>

            <div class="input-group">
              <label>Monospace Font Family</label>
              <select 
                value={draft().fontMono || ""}
                onChange={(e) => updateSetting("fontMono", e.currentTarget.value || undefined)}
              >
                <option value="">System monospace</option>
                <For each={getMonoFonts()}>
                  {(font) => <option value={font}>{font}</option>}
                </For>
              </select>
            </div>

            <div class="input-group">
              <div style={{ display: "flex", "justify-content": "space-between" }}>
                <label>Line Height</label>
                <span class="value-display">{(draft().lineHeight ?? 1.6).toFixed(1)}</span>
              </div>
              <input 
                type="range" 
                min="1.0" 
                max="2.5" 
                step="0.1"
                value={draft().lineHeight ?? 1.6}
                onInput={(e) => updateSetting("lineHeight", parseFloat(e.currentTarget.value))}
              />
            </div>

            <div class="input-group">
              <div style={{ display: "flex", "justify-content": "space-between" }}>
                <label>Font Scale Override</label>
                <span class="value-display">{draft().fontScale.toFixed(2)}x</span>
              </div>
              <input 
                type="range" 
                min="0.8" 
                max="1.5" 
                step="0.05"
                value={draft().fontScale}
                onInput={(e) => updateSetting("fontScale", parseFloat(e.currentTarget.value))}
              />
            </div>

            <div class="heading-sizes-grid">
              <div class="input-group-compact">
                <label>H1 size (em)</label>
                <input 
                  type="text" 
                  placeholder={(2.2 * draft().fontScale).toFixed(2)}
                  value={draft().sizeH1 || ""}
                  onChange={(e) => updateSetting("sizeH1", parseSizeValue(e.currentTarget.value))}
                />
              </div>
              <div class="input-group-compact">
                <label>H2 size (em)</label>
                <input 
                  type="text" 
                  placeholder={(1.65 * draft().fontScale).toFixed(2)}
                  value={draft().sizeH2 || ""}
                  onChange={(e) => updateSetting("sizeH2", parseSizeValue(e.currentTarget.value))}
                />
              </div>
              <div class="input-group-compact">
                <label>H3 size (em)</label>
                <input 
                  type="text" 
                  placeholder={(1.35 * draft().fontScale).toFixed(2)}
                  value={draft().sizeH3 || ""}
                  onChange={(e) => updateSetting("sizeH3", parseSizeValue(e.currentTarget.value))}
                />
              </div>
              <div class="input-group-compact">
                <label>H4 size (em)</label>
                <input 
                  type="text" 
                  placeholder={(1.15 * draft().fontScale).toFixed(2)}
                  value={draft().sizeH4 || ""}
                  onChange={(e) => updateSetting("sizeH4", parseSizeValue(e.currentTarget.value))}
                />
              </div>
            </div>
          </div>

          {/* Detailed color overrides remain collapsed until requested. */}
          <div class="theme-section">
            <button class="theme-advanced-toggle" aria-expanded={showAdvancedColors() ? "true" : "false"} onClick={() => setShowAdvancedColors((open) => !open)}>
              {showAdvancedColors() ? "Hide advanced colors" : "Advanced color overrides"}
            </button>
            <Show when={showAdvancedColors()}>
            <h4>Colors</h4>
            
            <div class="color-pickers-grid">
              <div class="color-picker-item">
                <label>Normal Text</label>
                <div class="color-input-wrapper">
                  <input 
                    type="color" 
                    value={draft().colorBody || defaults().colorBody}
                    onInput={(e) => updateSetting("colorBody", e.currentTarget.value)}
                  />
                  <input 
                    type="text" 
                    placeholder="default"
                    value={draft().colorBody || ""}
                    onInput={(e) => updateSetting("colorBody", e.currentTarget.value || undefined)}
                  />
                </div>
              </div>

              <div class="color-picker-item">
                <label>H1 Color</label>
                <div class="color-input-wrapper">
                  <input 
                    type="color" 
                    value={draft().colorH1 || defaults().colorH1}
                    onInput={(e) => updateSetting("colorH1", e.currentTarget.value)}
                  />
                  <input 
                    type="text" 
                    placeholder="default"
                    value={draft().colorH1 || ""}
                    onInput={(e) => updateSetting("colorH1", e.currentTarget.value || undefined)}
                  />
                </div>
              </div>

              <div class="color-picker-item">
                <label>H2 Color</label>
                <div class="color-input-wrapper">
                  <input 
                    type="color" 
                    value={draft().colorH2 || defaults().colorH2}
                    onInput={(e) => updateSetting("colorH2", e.currentTarget.value)}
                  />
                  <input 
                    type="text" 
                    placeholder="default"
                    value={draft().colorH2 || ""}
                    onInput={(e) => updateSetting("colorH2", e.currentTarget.value || undefined)}
                  />
                </div>
              </div>

              <div class="color-picker-item">
                <label>H3 Color</label>
                <div class="color-input-wrapper">
                  <input 
                    type="color" 
                    value={draft().colorH3 || defaults().colorH3}
                    onInput={(e) => updateSetting("colorH3", e.currentTarget.value)}
                  />
                  <input 
                    type="text" 
                    placeholder="default"
                    value={draft().colorH3 || ""}
                    onInput={(e) => updateSetting("colorH3", e.currentTarget.value || undefined)}
                  />
                </div>
              </div>

              <div class="color-picker-item">
                <label>H4 Color</label>
                <div class="color-input-wrapper">
                  <input 
                    type="color" 
                    value={draft().colorH4 || defaults().colorH4}
                    onInput={(e) => updateSetting("colorH4", e.currentTarget.value)}
                  />
                  <input 
                    type="text" 
                    placeholder="default"
                    value={draft().colorH4 || ""}
                    onInput={(e) => updateSetting("colorH4", e.currentTarget.value || undefined)}
                  />
                </div>
              </div>

              <div class="color-picker-item">
                <label>Code Text</label>
                <div class="color-input-wrapper">
                  <input 
                    type="color" 
                    value={draft().colorCodeText || defaults().colorCodeText}
                    onInput={(e) => updateSetting("colorCodeText", e.currentTarget.value)}
                  />
                  <input 
                    type="text" 
                    placeholder="default"
                    value={draft().colorCodeText || ""}
                    onInput={(e) => updateSetting("colorCodeText", e.currentTarget.value || undefined)}
                  />
                </div>
              </div>

              <div class="color-picker-item">
                <label>Code Bg</label>
                <div class="color-input-wrapper">
                  <input 
                    type="color" 
                    value={draft().colorCodeBg || defaults().colorCodeBg}
                    onInput={(e) => updateSetting("colorCodeBg", e.currentTarget.value)}
                  />
                  <input 
                    type="text" 
                    placeholder="default"
                    value={draft().colorCodeBg || ""}
                    onInput={(e) => updateSetting("colorCodeBg", e.currentTarget.value || undefined)}
                  />
                </div>
              </div>

              <div class="color-picker-item">
                <label>Text Selection</label>
                <div class="color-input-wrapper">
                  <input
                    type="color"
                    value={draft().colorSelection || defaults().colorSelection}
                    onInput={(e) => updateSetting("colorSelection", e.currentTarget.value)}
                  />
                  <input
                    type="text"
                    placeholder="default"
                    value={draft().colorSelection || ""}
                    onInput={(e) => updateSetting("colorSelection", e.currentTarget.value || undefined)}
                  />
                </div>
              </div>

              <div class="color-picker-item">
                <label>Link Color</label>
                <div class="color-input-wrapper">
                  <input 
                    type="color" 
                    value={draft().colorLink || defaults().colorLink}
                    onInput={(e) => updateSetting("colorLink", e.currentTarget.value)}
                  />
                  <input 
                    type="text" 
                    placeholder="default"
                    value={draft().colorLink || ""}
                    onInput={(e) => updateSetting("colorLink", e.currentTarget.value || undefined)}
                  />
                </div>
              </div>

              <div class="color-picker-item">
                <label>Link Hover</label>
                <div class="color-input-wrapper">
                  <input 
                    type="color" 
                    value={draft().colorLinkHover || defaults().colorLinkHover}
                    onInput={(e) => updateSetting("colorLinkHover", e.currentTarget.value)}
                  />
                  <input 
                    type="text" 
                    placeholder="default"
                    value={draft().colorLinkHover || ""}
                    onInput={(e) => updateSetting("colorLinkHover", e.currentTarget.value || undefined)}
                  />
                </div>
              </div>
            </div>
            
            </Show>
            <button class="btn btn-secondary btn-full" style={{ "margin-top": "12px" }} onClick={handleReset}>
              Reset to default settings
            </button>
          </div>

          {/* Section: Custom Fonts */}
          <div class="theme-section">
            <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "8px" }}>
              <h4>Custom Fonts</h4>
              <button disabled={isLongOperationPending()}
                class="btn btn-secondary btn-compact" 
                onClick={() => setIsImporting(!isImporting())}
              >
                <Icon name="plus" size={12} /> {isImporting() ? "Cancel" : "Add Font"}
              </button>
            </div>

            <Show when={isImporting()}>
              <div class="import-font-form">
                <h5>Import Custom Font</h5>
                {importError() && <div class="import-error">{importError()}</div>}
                
                <div class="input-group">
                  <label>Font File</label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input 
                      type="text" 
                      readonly 
                      placeholder="Select .ttf, .otf, .woff, .woff2" 
                      value={importFilePath() ? importFilePath().split(/[/\\]/).pop() || "" : ""} 
                    />
                    <button class="btn btn-secondary" onClick={handlePickFontFile}>Browse</button>
                  </div>
                </div>

                <div class="input-group">
                  <label>Family Name</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Fira Sans" 
                    value={importFamily()}
                    onInput={(e) => setImportFamily(e.currentTarget.value)}
                  />
                </div>

                <div class="form-row">
                  <div class="input-group">
                    <label>Weight</label>
                    <select value={importWeight()} onChange={(e) => setImportWeight(e.currentTarget.value)}>
                      <option value="400">400 (Regular)</option>
                      <option value="700">700 (Bold)</option>
                      <option value="300">300 (Light)</option>
                      <option value="900">900 (Black)</option>
                    </select>
                  </div>
                  <div class="input-group">
                    <label>Style</label>
                    <select value={importStyle()} onChange={(e) => setImportStyle(e.currentTarget.value)}>
                      <option value="normal">Normal</option>
                      <option value="italic">Italic</option>
                    </select>
                  </div>
                </div>

                <button class="btn btn-primary btn-full" onClick={handleConfirmImport}>
                  Import Font File
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
                        <span class="font-meta">{font.weight} / {font.style}</span>
                      </div>
                      <button class="btn-delete-font" onClick={() => handleDeleteFont(font)}>
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>

          {/* Section: Export / Import Theme */}
          <div class="theme-section">
            <h4>Theme Profiles</h4>
            <div style={{ display: "flex", gap: "12px" }}>
              <button class="btn btn-secondary" style={{ flex: 1 }} disabled={isLongOperationPending()} onClick={handleExportTheme}>
                <Icon name="download" size={14} /> Export Theme
              </button>
              <button class="btn btn-secondary" style={{ flex: 1 }} disabled={isLongOperationPending()} onClick={handleImportTheme}>
                <Icon name="upload" size={14} /> Import Theme
              </button>
            </div>
          </div>
        </div>
        </Show>
        </fieldset>
        <div class="theme-panel-footer">
          <Show when={applyError()}><div class="apply-error" role="alert">{applyError()}</div></Show>
          <Show when={validationError() && isDirty()}><div class="apply-error" role="status">{validationError()}</div></Show>
          <div class="theme-panel-footer-actions">
            <button class="btn btn-secondary" disabled={isApplying() || props.isClosing} onClick={() => props.onClose()}>Cancel</button>
            <button class="btn btn-primary" disabled={props.isClosing || !isDirty() || Boolean(validationError()) || isApplying() || isLongOperationPending()} onClick={handleApply}>
              {isApplying() ? "Applying…" : "Apply"}
            </button>
          </div>
        </div>
    </ModalLayer>
  );
}
