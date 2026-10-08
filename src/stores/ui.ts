import { createStore } from "solid-js/store";

interface UIState {
  expandedNodes: Record<string, boolean>;
  selectedEntryId: string | null;
  isSidebarOpen: boolean;
  sidebarWidth: number;
  hideUnsupportedFiles: boolean;
  isReferencePanelOpen: boolean;
}

const savedWidth = typeof window !== "undefined" ? localStorage.getItem("sidebarWidth") : null;
const initialWidth = savedWidth ? (parseInt(savedWidth, 10) || 280) : 280;
const hideUnsupportedFiles = typeof window !== "undefined" ? localStorage.getItem("collectives.hideUnsupportedFiles.v1") === "true" : false;

const [state, setState] = createStore<UIState>({
  expandedNodes: {},
  selectedEntryId: null,
  isSidebarOpen: true,
  sidebarWidth: initialWidth,
  hideUnsupportedFiles,
  isReferencePanelOpen: false,
});

export const uiStore = {
  state,
  
  toggleSidebar() {
    setState("isSidebarOpen", (prev) => !prev);
  },

  toggleReferencePanel() {
    setState("isReferencePanelOpen", (open) => !open);
  },

  setReferencePanelOpen(open: boolean) {
    setState("isReferencePanelOpen", open);
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

  setHideUnsupportedFiles(hidden: boolean) {
    setState("hideUnsupportedFiles", hidden);
    if (typeof window !== "undefined") localStorage.setItem("collectives.hideUnsupportedFiles.v1", String(hidden));
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
      isReferencePanelOpen: false,
    });
  }
};
