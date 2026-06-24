import { createStore } from "solid-js/store";

interface UIState {
  expandedNodes: Record<string, boolean>;
  selectedEntryId: string | null;
  isSidebarOpen: boolean;
  sidebarWidth: number;
}

const savedWidth = typeof window !== "undefined" ? localStorage.getItem("sidebarWidth") : null;
const initialWidth = savedWidth ? (parseInt(savedWidth, 10) || 280) : 280;

const [state, setState] = createStore<UIState>({
  expandedNodes: {},
  selectedEntryId: null,
  isSidebarOpen: true,
  sidebarWidth: initialWidth,
});

export const uiStore = {
  state,
  
  toggleSidebar() {
    setState("isSidebarOpen", (prev) => !prev);
  },

  setSidebarOpen(open: boolean) {
    setState("isSidebarOpen", open);
  },

  setSidebarWidth(width: number) {
    setState("sidebarWidth", width);
    if (typeof window !== "undefined") {
      localStorage.setItem("sidebarWidth", String(width));
    }
  },
  
  toggleExpand(id: string) {
    setState("expandedNodes", id, (prev) => !prev);
  },
  
  setExpanded(id: string, expanded: boolean) {
    setState("expandedNodes", id, expanded);
  },
  
  isExpanded(id: string): boolean {
    return !!state.expandedNodes[id];
  },
  
  selectEntry(id: string | null) {
    setState("selectedEntryId", id);
    if (typeof window !== "undefined") {
      if (id) {
        localStorage.setItem("lastSelectedEntryId", id);
      } else {
        localStorage.removeItem("lastSelectedEntryId");
      }
    }
  },
  
  isSelected(id: string): boolean {
    return state.selectedEntryId === id;
  },
  
  reset() {
    setState({
      expandedNodes: {},
      selectedEntryId: null,
    });
  }
};
