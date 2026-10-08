import { render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { uiStore } from "./stores/ui";

vi.mock("./features/collections", () => ({
  getCollections: vi.fn(() => Promise.resolve([])),
  initializeIdentityCache: vi.fn(() => Promise.resolve()),
}));

vi.mock("./features/settings", () => ({
  loadSettings: vi.fn(() => Promise.resolve({ theme: "dark", fontScale: 1, customFonts: [] })),
  getFontsDir: vi.fn(() => Promise.resolve("/mock/fonts")),
}));

vi.mock("./features/archive", () => ({ checkZipConflicts: vi.fn(() => Promise.resolve([])) }));
vi.mock("./platform/assets", () => ({ convertFileSrc: vi.fn((path: string) => `asset://${path}`) }));

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe("Phase 4 App shell integration", () => {
  it("keeps presentation rerendering inside the four-slot shell", () => {
    uiStore.setSidebarOpen(true);
    const { container, getByRole, getByText } = render(() => <App />);

    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelector("aside[aria-label='Collection navigation']")).not.toBeNull();
    expect(container.querySelectorAll("[data-shell-slot]")).toHaveLength(4);
    expect(getByRole("status")).toBeDefined();
    expect(getByText("Welcome to Collectives")).toBeDefined();
    expect(container.querySelectorAll(".empty-workspace .btn-primary")).toHaveLength(1);
    expect(document.body.querySelector("[data-modal-layer='true']")).toBeNull();
  });
});
