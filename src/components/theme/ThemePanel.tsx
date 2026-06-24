import { createSignal, Show, For, onMount, onCleanup } from "solid-js";
import { Settings, CustomFont } from "../../types";
import { Icon } from "../common/Icon";
import * as api from "../../lib/tauri";
import { applyThemeSettings, registerCustomFonts, getDefaultThemeValues } from "../../lib/themeEngine";
import { ask, message } from "@tauri-apps/plugin-dialog";
import "./ThemePanel.css";

interface ThemePanelProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  onSettingsChange: (newSettings: Settings) => void;
}

export function ThemePanel(props: ThemePanelProps) {
  // Local state for font import form
  const [isImporting, setIsImporting] = createSignal(false);
  const [importFilePath, setImportFilePath] = createSignal("");
  const [importFamily, setImportFamily] = createSignal("");
  const [importWeight, setImportWeight] = createSignal("400");
  const [importStyle, setImportStyle] = createSignal("normal");
  const [importError, setImportError] = createSignal("");

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
    if (props.settings.theme === "dark") return true;
    if (props.settings.theme === "light") return false;
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
    const updated = { ...props.settings, [key]: value };
    props.onSettingsChange(updated);
    applyThemeSettings(updated);
    
    // Save to settings.json
    api.saveSettings(updated).catch((err) => {
      console.error("Failed to save settings", err);
    });
  };

  // Reset to defaults
  const handleReset = () => {
    const resetSettings: Settings = {
      theme: "dark",
      fontBody: undefined,
      fontMono: undefined,
      fontScale: 1.0,
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
      colorLink: undefined,
      colorLinkHover: undefined,
      customFonts: props.settings.customFonts, // Keep custom fonts registered
    };
    props.onSettingsChange(resetSettings);
    applyThemeSettings(resetSettings);
    api.saveSettings(resetSettings).catch((err) => console.error(err));
  };

  // Font Picker Options
  const getBodyFonts = () => {
    const list = ["Outfit", "Inter", "system-ui", "Georgia", "Arial"];
    const custom = props.settings.customFonts || [];
    const uniqueCustom = Array.from(new Set(custom.map(f => f.family)));
    return [...list, ...uniqueCustom];
  };

  const getMonoFonts = () => {
    const list = ["Fira Code", "Courier New", "Consolas", "monospace"];
    const custom = props.settings.customFonts || [];
    const uniqueCustom = Array.from(new Set(custom.map(f => f.family)));
    return [...list, ...uniqueCustom];
  };

  // Import font handlers
  const handlePickFontFile = async () => {
    try {
      const selected = await api.pickFontFile("Select Font File");
      if (selected) {
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
      const newFont = await api.importFont(
        importFilePath(),
        importFamily().trim(),
        importWeight(),
        importStyle()
      );

      const existingFonts = props.settings.customFonts || [];
      const updatedFonts = [...existingFonts, newFont];
      
      updateSetting("customFonts", updatedFonts);

      // Re-register fonts in engine
      const fontsDir = await api.getFontsDir();
      registerCustomFonts(updatedFonts, fontsDir);

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
    if (!confirmed) {
      return;
    }
    try {
      await api.deleteFont(font.fileName);
      const existingFonts = props.settings.customFonts || [];
      const updatedFonts = existingFonts.filter(f => f.fileName !== font.fileName);
      
      updateSetting("customFonts", updatedFonts);

      // Re-register in engine
      const fontsDir = await api.getFontsDir();
      registerCustomFonts(updatedFonts, fontsDir);
    } catch (err) {
      console.error("Failed to delete font file", err);
    }
  };

  // Export Theme Handler
  const handleExportTheme = async () => {
    try {
      const destPath = await api.saveThemeDialog("Export Theme JSON");
      if (!destPath) return;

      await api.exportTheme(props.settings, destPath);
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
      const themePath = await api.pickThemeFile("Select Theme JSON to Import");
      if (!themePath) return;

      const importedSettings = await api.importTheme(themePath);
      
      props.onSettingsChange(importedSettings);
      applyThemeSettings(importedSettings);
      
      // Save settings.json
      await api.saveSettings(importedSettings);

      // Re-register custom fonts from imported settings
      const fontsDir = await api.getFontsDir();
      registerCustomFonts(importedSettings.customFonts, fontsDir);

      await message("Theme imported and applied successfully!", {
        title: "Import Theme",
        kind: "info",
      });
    } catch (err) {
      console.error(err);
      await message(`Import failed: ${err}`, {
        title: "Import Theme Failed",
        kind: "error",
      });
    }
  };

  return (
    <div class={`theme-panel-backdrop ${props.isOpen ? "open" : ""}`} onClick={() => props.onClose()}>
      <div class="theme-panel" onClick={(e) => e.stopPropagation()}>
        <div class="theme-panel-header">
          <h3>Appearance & Theming</h3>
          <button class="btn-close" onClick={() => props.onClose()}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div class="theme-panel-content">
          {/* Section: Theme Mode */}
          <div class="theme-section">
            <h4>Theme Mode</h4>
            <div class="theme-mode-options">
              <button 
                class={`mode-option-btn ${props.settings.theme === "light" ? "active" : ""}`}
                onClick={() => updateSetting("theme", "light")}
              >
                <Icon name="sun" size={14} /> Light
              </button>
              <button 
                class={`mode-option-btn ${props.settings.theme === "dark" ? "active" : ""}`}
                onClick={() => updateSetting("theme", "dark")}
              >
                <Icon name="moon" size={14} /> Dark
              </button>
              <button 
                class={`mode-option-btn ${props.settings.theme === "system" ? "active" : ""}`}
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
                value={props.settings.fontBody || ""} 
                onChange={(e) => updateSetting("fontBody", e.currentTarget.value || undefined)}
              >
                <option value="">Default (Outfit)</option>
                <For each={getBodyFonts()}>
                  {(font) => <option value={font}>{font}</option>}
                </For>
              </select>
            </div>

            <div class="input-group">
              <label>Monospace Font Family</label>
              <select 
                value={props.settings.fontMono || ""} 
                onChange={(e) => updateSetting("fontMono", e.currentTarget.value || undefined)}
              >
                <option value="">Default (Fira Code)</option>
                <For each={getMonoFonts()}>
                  {(font) => <option value={font}>{font}</option>}
                </For>
              </select>
            </div>

            <div class="input-group">
              <div style={{ display: "flex", "justify-content": "space-between" }}>
                <label>Font Scale Override</label>
                <span class="value-display">{props.settings.fontScale.toFixed(2)}x</span>
              </div>
              <input 
                type="range" 
                min="0.8" 
                max="1.5" 
                step="0.05"
                value={props.settings.fontScale}
                onInput={(e) => updateSetting("fontScale", parseFloat(e.currentTarget.value))}
              />
            </div>

            <div class="heading-sizes-grid">
              <div class="input-group-compact">
                <label>H1 size (em)</label>
                <input 
                  type="text" 
                  placeholder={(2.2 * props.settings.fontScale).toFixed(2)}
                  value={props.settings.sizeH1 || ""}
                  onChange={(e) => updateSetting("sizeH1", parseSizeValue(e.currentTarget.value))}
                />
              </div>
              <div class="input-group-compact">
                <label>H2 size (em)</label>
                <input 
                  type="text" 
                  placeholder={(1.65 * props.settings.fontScale).toFixed(2)}
                  value={props.settings.sizeH2 || ""}
                  onChange={(e) => updateSetting("sizeH2", parseSizeValue(e.currentTarget.value))}
                />
              </div>
              <div class="input-group-compact">
                <label>H3 size (em)</label>
                <input 
                  type="text" 
                  placeholder={(1.35 * props.settings.fontScale).toFixed(2)}
                  value={props.settings.sizeH3 || ""}
                  onChange={(e) => updateSetting("sizeH3", parseSizeValue(e.currentTarget.value))}
                />
              </div>
              <div class="input-group-compact">
                <label>H4 size (em)</label>
                <input 
                  type="text" 
                  placeholder={(1.15 * props.settings.fontScale).toFixed(2)}
                  value={props.settings.sizeH4 || ""}
                  onChange={(e) => updateSetting("sizeH4", parseSizeValue(e.currentTarget.value))}
                />
              </div>
            </div>
          </div>

          {/* Section: Colors */}
          <div class="theme-section">
            <h4>Colors</h4>
            
            <div class="color-pickers-grid">
              <div class="color-picker-item">
                <label>Normal Text</label>
                <div class="color-input-wrapper">
                  <input 
                    type="color" 
                    value={props.settings.colorBody || defaults().colorBody}
                    onInput={(e) => updateSetting("colorBody", e.currentTarget.value)}
                  />
                  <input 
                    type="text" 
                    placeholder="default"
                    value={props.settings.colorBody || ""}
                    onInput={(e) => updateSetting("colorBody", e.currentTarget.value || undefined)}
                  />
                </div>
              </div>

              <div class="color-picker-item">
                <label>H1 Color</label>
                <div class="color-input-wrapper">
                  <input 
                    type="color" 
                    value={props.settings.colorH1 || defaults().colorH1}
                    onInput={(e) => updateSetting("colorH1", e.currentTarget.value)}
                  />
                  <input 
                    type="text" 
                    placeholder="default"
                    value={props.settings.colorH1 || ""}
                    onInput={(e) => updateSetting("colorH1", e.currentTarget.value || undefined)}
                  />
                </div>
              </div>

              <div class="color-picker-item">
                <label>H2 Color</label>
                <div class="color-input-wrapper">
                  <input 
                    type="color" 
                    value={props.settings.colorH2 || defaults().colorH2}
                    onInput={(e) => updateSetting("colorH2", e.currentTarget.value)}
                  />
                  <input 
                    type="text" 
                    placeholder="default"
                    value={props.settings.colorH2 || ""}
                    onInput={(e) => updateSetting("colorH2", e.currentTarget.value || undefined)}
                  />
                </div>
              </div>

              <div class="color-picker-item">
                <label>H3 Color</label>
                <div class="color-input-wrapper">
                  <input 
                    type="color" 
                    value={props.settings.colorH3 || defaults().colorH3}
                    onInput={(e) => updateSetting("colorH3", e.currentTarget.value)}
                  />
                  <input 
                    type="text" 
                    placeholder="default"
                    value={props.settings.colorH3 || ""}
                    onInput={(e) => updateSetting("colorH3", e.currentTarget.value || undefined)}
                  />
                </div>
              </div>

              <div class="color-picker-item">
                <label>H4 Color</label>
                <div class="color-input-wrapper">
                  <input 
                    type="color" 
                    value={props.settings.colorH4 || defaults().colorH4}
                    onInput={(e) => updateSetting("colorH4", e.currentTarget.value)}
                  />
                  <input 
                    type="text" 
                    placeholder="default"
                    value={props.settings.colorH4 || ""}
                    onInput={(e) => updateSetting("colorH4", e.currentTarget.value || undefined)}
                  />
                </div>
              </div>

              <div class="color-picker-item">
                <label>Code Text</label>
                <div class="color-input-wrapper">
                  <input 
                    type="color" 
                    value={props.settings.colorCodeText || defaults().colorCodeText}
                    onInput={(e) => updateSetting("colorCodeText", e.currentTarget.value)}
                  />
                  <input 
                    type="text" 
                    placeholder="default"
                    value={props.settings.colorCodeText || ""}
                    onInput={(e) => updateSetting("colorCodeText", e.currentTarget.value || undefined)}
                  />
                </div>
              </div>

              <div class="color-picker-item">
                <label>Code Bg</label>
                <div class="color-input-wrapper">
                  <input 
                    type="color" 
                    value={props.settings.colorCodeBg || defaults().colorCodeBg}
                    onInput={(e) => updateSetting("colorCodeBg", e.currentTarget.value)}
                  />
                  <input 
                    type="text" 
                    placeholder="default"
                    value={props.settings.colorCodeBg || ""}
                    onInput={(e) => updateSetting("colorCodeBg", e.currentTarget.value || undefined)}
                  />
                </div>
              </div>

              <div class="color-picker-item">
                <label>Link Color</label>
                <div class="color-input-wrapper">
                  <input 
                    type="color" 
                    value={props.settings.colorLink || defaults().colorLink}
                    onInput={(e) => updateSetting("colorLink", e.currentTarget.value)}
                  />
                  <input 
                    type="text" 
                    placeholder="default"
                    value={props.settings.colorLink || ""}
                    onInput={(e) => updateSetting("colorLink", e.currentTarget.value || undefined)}
                  />
                </div>
              </div>

              <div class="color-picker-item">
                <label>Link Hover</label>
                <div class="color-input-wrapper">
                  <input 
                    type="color" 
                    value={props.settings.colorLinkHover || defaults().colorLinkHover}
                    onInput={(e) => updateSetting("colorLinkHover", e.currentTarget.value)}
                  />
                  <input 
                    type="text" 
                    placeholder="default"
                    value={props.settings.colorLinkHover || ""}
                    onInput={(e) => updateSetting("colorLinkHover", e.currentTarget.value || undefined)}
                  />
                </div>
              </div>
            </div>
            
            <button class="btn btn-secondary btn-full" style={{ "margin-top": "12px" }} onClick={handleReset}>
              Reset to default settings
            </button>
          </div>

          {/* Section: Custom Fonts */}
          <div class="theme-section">
            <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "8px" }}>
              <h4>Custom Fonts</h4>
              <button 
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
                when={props.settings.customFonts && props.settings.customFonts.length > 0}
                fallback={<div class="fonts-empty">No custom fonts imported.</div>}
              >
                <For each={props.settings.customFonts}>
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
              <button class="btn btn-secondary" style={{ flex: 1 }} onClick={handleExportTheme}>
                <Icon name="download" size={14} /> Export Theme
              </button>
              <button class="btn btn-secondary" style={{ flex: 1 }} onClick={handleImportTheme}>
                <Icon name="upload" size={14} /> Import Theme
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
