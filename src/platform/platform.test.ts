import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
  ask: vi.fn(),
  message: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: vi.fn((path: string) => `asset://${path}`) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: vi.fn(() => ({ id: "main" })) }));

describe("Phase 2 platform gateways", () => {
  it("normalizes dialog selections and keeps asset/window operations behind gateways", async () => {
    const dialog = await import("@tauri-apps/plugin-dialog");
    vi.mocked(dialog.open).mockResolvedValueOnce(["a.md", "b.md"]);
    const { pickFiles } = await import("./dialogs");
    expect(await pickFiles("Notes")).toEqual(["a.md", "b.md"]);

    const { convertFileSrc } = await import("./assets");
    expect(convertFileSrc("C:/note.md")).toBe("asset://C:/note.md");
    const { getCurrentAppWindow } = await import("./windowLifecycle");
    expect(getCurrentAppWindow()).toEqual({ id: "main" });
  });
});
