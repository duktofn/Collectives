import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../../types";
import { ThemePanel } from "./ThemePanel";

const settingsApi = vi.hoisted(() => ({
  saveSettings: vi.fn(),
  importFont: vi.fn(),
  deleteFont: vi.fn(),
  getFontsDir: vi.fn(),
  exportTheme: vi.fn(),
  importTheme: vi.fn(),
}));
const themeEngine = vi.hoisted(() => ({
  applyThemeSettings: vi.fn(),
  registerCustomFonts: vi.fn(),
  getDefaultThemeValues: vi.fn(() => ({
    fontScale: "1", sizeH1: "2.2", sizeH2: "1.65", sizeH3: "1.35", sizeH4: "1.15", lineHeight: "1.6",
    colorH1: "#111111", colorBody: "#111111", colorH2: "#111111", colorH3: "#111111", colorH4: "#111111",
    colorCodeBg: "#222222", colorCodeText: "#eeeeee", colorSelection: "#d7d4f0", colorLink: "#6366f1", colorLinkHover: "#4f46e5",
  })),
}));

vi.mock("../../features/settings", () => settingsApi);
vi.mock("../../lib/themeEngine", () => themeEngine);
vi.mock("../../platform", () => ({
  ask: vi.fn(() => Promise.resolve(true)),
  message: vi.fn(() => Promise.resolve()),
  pickFontFile: vi.fn(() => Promise.resolve(null)),
  saveThemeDialog: vi.fn(() => Promise.resolve(null)),
  pickThemeFile: vi.fn(() => Promise.resolve(null)),
}));

describe("ThemePanel settings draft", () => {
  const initial: Settings = { theme: "dark", fontScale: 1, customFonts: [], hideUnsupportedFiles: false };

  beforeEach(() => {
    vi.clearAllMocks();
    settingsApi.saveSettings.mockResolvedValue(undefined);
    settingsApi.getFontsDir.mockResolvedValue("/fonts");
  });

  it("keeps edits local until Apply and leaves the last applied baseline on Cancel", async () => {
    const onClose = vi.fn();
    const onSettingsChange = vi.fn();
    render(() => <ThemePanel isOpen={true} onClose={onClose} settings={initial} onSettingsChange={onSettingsChange} />);

    await fireEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(onSettingsChange).not.toHaveBeenCalled();
    expect(settingsApi.saveSettings).not.toHaveBeenCalled();
    expect(themeEngine.applyThemeSettings).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(settingsApi.saveSettings).toHaveBeenCalledOnce());
    await waitFor(() => expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ theme: "light" })));
    expect(themeEngine.applyThemeSettings).toHaveBeenCalledOnce();

    await fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSettingsChange).toHaveBeenCalledOnce();
    expect(settingsApi.saveSettings).toHaveBeenCalledOnce();
  });

  it("retains the draft and keeps the app untouched after a save failure", async () => {
    settingsApi.saveSettings.mockRejectedValueOnce(new Error("disk full"));
    const onSettingsChange = vi.fn();
    render(() => <ThemePanel isOpen={true} onClose={vi.fn()} settings={initial} onSettingsChange={onSettingsChange} />);

    await fireEvent.click(screen.getByRole("button", { name: "Light" }));
    await fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("disk full"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Light" }).classList.contains("active")).toBe(true);
    expect(onSettingsChange).not.toHaveBeenCalled();
    expect(themeEngine.applyThemeSettings).not.toHaveBeenCalled();
  });

  it("does not mark Reset dirty when defaults already match the applied settings", async () => {
    render(() => <ThemePanel isOpen={true} onClose={vi.fn()} settings={initial} onSettingsChange={vi.fn()} />);

    await fireEvent.click(screen.getByRole("button", { name: "Reset to default settings" }));

    expect(screen.getByRole("button", { name: "Apply" }).hasAttribute("disabled")).toBe(true);
    expect(settingsApi.saveSettings).not.toHaveBeenCalled();
  });

  it.each(["Cancel", "Close button", "Escape", "backdrop"] as const)("discards the draft on %s", async (closePath) => {
    const onClose = vi.fn();
    const onSettingsChange = vi.fn();
    render(() => <ThemePanel isOpen={true} onClose={onClose} settings={initial} onSettingsChange={onSettingsChange} />);
    await fireEvent.click(screen.getByRole("button", { name: "Light" }));

    if (closePath === "Cancel") {
      await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    } else if (closePath === "Close button") {
      await fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    } else if (closePath === "Escape") {
      await fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    } else {
      const backdrop = document.querySelector(".theme-panel-backdrop");
      expect(backdrop).not.toBeNull();
      await fireEvent.click(backdrop as HTMLElement);
    }

    expect(onClose).toHaveBeenCalledOnce();
    expect(onSettingsChange).not.toHaveBeenCalled();
    expect(settingsApi.saveSettings).not.toHaveBeenCalled();
    expect(themeEngine.applyThemeSettings).not.toHaveBeenCalled();
  });

  it("locks close paths until an Apply request settles", async () => {
    let finishSave!: () => void;
    settingsApi.saveSettings.mockImplementationOnce(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    const onClose = vi.fn();
    render(() => <ThemePanel isOpen={true} onClose={onClose} settings={initial} onSettingsChange={vi.fn()} />);

    await fireEvent.click(screen.getByRole("button", { name: "Light" }));
    await fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Applying…" })).toBeTruthy());

    await fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await fireEvent.click(document.querySelector(".theme-panel-backdrop") as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Close settings" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);

    finishSave();
    await waitFor(() => expect(themeEngine.applyThemeSettings).toHaveBeenCalledOnce());
    expect(onClose).not.toHaveBeenCalled();
  });
});
