import { Settings, CustomFont } from "../types";
import { convertFileSrc } from "@tauri-apps/api/core";
import { requestEditorMeasure } from "./editorMeasure";

const variableMappings: Record<keyof Omit<Settings, "theme" | "customFonts">, string> = {
  fontScale: "--font-scale",
  fontBody: "--font-body",
  fontMono: "--font-mono",
  sizeH1: "--size-h1",
  sizeH2: "--size-h2",
  sizeH3: "--size-h3",
  sizeH4: "--size-h4",
  colorH1: "--color-h1",
  colorBody: "--color-text-primary",
  colorH2: "--color-h2",
  colorH3: "--color-h3",
  colorH4: "--color-h4",
  colorCodeBg: "--color-code-bg",
  colorCodeText: "--color-code-text",
  colorLink: "--color-link",
  colorLinkHover: "--color-link-hover",
};

/**
 * Applies theme settings to the document root elements
 */
export function applyThemeSettings(settings: Settings): void {
  const root = document.documentElement;

  // 1. Apply theme attribute (dark / light / system)
  if (settings.theme === "dark" || settings.theme === "light") {
    root.setAttribute("data-theme", settings.theme);
  } else {
    root.removeAttribute("data-theme");
  }

  // 2. Apply all variables
  for (const [key, varName] of Object.entries(variableMappings) as [keyof Omit<Settings, "theme" | "customFonts">, string][]) {
    const value = settings[key];
    if (value !== undefined && value !== null && value !== "") {
      if (typeof value === "number") {
        if (key.startsWith("sizeH")) {
          root.style.setProperty(varName, `${value}em`);
        } else {
          root.style.setProperty(varName, String(value));
        }
      } else {
        root.style.setProperty(varName, String(value));
      }
    } else {
      root.style.removeProperty(varName);
    }
  }

  requestEditorMeasure();
}

/**
 * Registers custom @font-face declarations dynamically in the document head
 */
export function registerCustomFonts(fonts: CustomFont[] | undefined, fontsDir: string | null): void {
  if (!fonts || !fonts.length || !fontsDir) {
    const existing = document.getElementById("custom-fonts-style");
    if (existing) {
      existing.remove();
    }
    return;
  }

  let styleEl = document.getElementById("custom-fonts-style") as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "custom-fonts-style";
    document.head.appendChild(styleEl);
  }

  let cssContent = "";
  for (const font of fonts) {
    const safeFamily = font.family.replace(/['"\\;{}()[\]*]/g, "");
    const safeWeight = font.weight.replace(/[^a-zA-Z0-9-]/g, "");
    const safeStyle = font.style.replace(/[^a-zA-Z0-9-]/g, "");

    // Construct the absolute path for the font file
    const absolutePath = `${fontsDir}/${font.fileName}`.replace(/[/\\]+/g, "/");
    const srcUrl = convertFileSrc(absolutePath);
    const safeSrcUrl = srcUrl.replace(/['"\\()[\]]/g, "");
    
    // Determine format from filename
    let format = "truetype";
    if (font.fileName.endsWith(".woff2")) {
      format = "woff2";
    } else if (font.fileName.endsWith(".woff")) {
      format = "woff";
    } else if (font.fileName.endsWith(".otf")) {
      format = "opentype";
    }

    cssContent += `
@font-face {
  font-family: '${safeFamily}';
  src: url('${safeSrcUrl}') format('${format}');
  font-weight: ${safeWeight};
  font-style: ${safeStyle};
  font-display: swap;
}
`;
  }

  styleEl.textContent = cssContent;
}

/**
 * Returns default values for settings variables to display in UI placeholders
 */
export function getDefaultThemeValues(isDarkMode: boolean): Record<string, string> {
  if (isDarkMode) {
    return {
      fontScale: "1",
      sizeH1: "2.2",
      sizeH2: "1.65",
      sizeH3: "1.35",
      sizeH4: "1.15",
      colorH1: "#e6e3dd",
      colorBody: "#e6e3dd",
      colorH2: "#e6e3dd",
      colorH3: "#e6e3dd",
      colorH4: "#a39f96",
      colorCodeBg: "#22201e",
      colorCodeText: "#e57e54",
      colorLink: "#6366f1",
      colorLinkHover: "#4f46e5",
    };
  } else {
    return {
      fontScale: "1",
      sizeH1: "2.2",
      sizeH2: "1.65",
      sizeH3: "1.35",
      sizeH4: "1.15",
      colorH1: "#191919",
      colorBody: "#191919",
      colorH2: "#191919",
      colorH3: "#191919",
      colorH4: "#706b64",
      colorCodeBg: "#f4f1ea",
      colorCodeText: "#d96236",
      colorLink: "#6366f1",
      colorLinkHover: "#4f46e5",
    };
  }
}
