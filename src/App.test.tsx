import { render, fireEvent } from '@solidjs/testing-library';
import { describe, it, expect, vi } from 'vitest';
import App from './App';
import { uiStore } from './stores/ui';

// Mock Tauri APIs
vi.mock("./features/collections", () => ({
  getCollections: vi.fn(() => Promise.resolve([])),
  initializeIdentityCache: vi.fn(() => Promise.resolve()),
}));

vi.mock("./features/settings", () => ({
  loadSettings: vi.fn(() => Promise.resolve({
    theme: "dark",
    fontScale: 1.0,
    customFonts: [],
  })),
  getFontsDir: vi.fn(() => Promise.resolve("/mock/fonts")),
}));

vi.mock("./features/archive", () => ({
  checkZipConflicts: vi.fn(() => Promise.resolve([])),
}));

vi.mock("./platform/assets", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), 
    removeListener: vi.fn(), 
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe('App Component', () => {
  it('renders welcome message', () => {
    const { getByText } = render(() => <App />);
    expect(getByText('Welcome to Collectives')).toBeDefined();
  });

  it('toggles sidebar collapse/expand', async () => {
    // Ensure sidebar is open initially
    uiStore.setSidebarOpen(true);
    
    const { container, queryByTitle } = render(() => <App />);
    
    // Find sidebar slot element
    const sidebarSlot = container.querySelector('.app-shell-sidebar-slot');
    expect(sidebarSlot).not.toBeNull();
    expect(sidebarSlot!.classList.contains('is-collapsed')).toBe(false);
    
    // Find collapse button
    const collapseBtn = queryByTitle('Collapse sidebar');
    expect(collapseBtn).not.toBeNull();
    
    // Click collapse button
    fireEvent.click(collapseBtn!);
    
    // Sidebar slot should have is-collapsed class
    expect(sidebarSlot!.classList.contains('is-collapsed')).toBe(true);
    
    // The welcome screen expand button should be visible
    const expandBtn = queryByTitle('Expand sidebar');
    expect(expandBtn).not.toBeNull();
    
    // Click expand button
    fireEvent.click(expandBtn!);
    
    // Sidebar slot should be open again
    expect(sidebarSlot!.classList.contains('is-collapsed')).toBe(false);
  });

  it('renders sidebar resizer handle', () => {
    const { container } = render(() => <App />);
    const resizer = container.querySelector('.sidebar-resizer');
    expect(resizer).not.toBeNull();
  });
});
