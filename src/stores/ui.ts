import { createStore } from "solid-js/store";

interface UIState {
  expandedNodes: Record<string, boolean>;
  selectedEntryId: string | null;
}

const [state, setState] = createStore<UIState>({
  expandedNodes: {},
  selectedEntryId: null,
});

export const uiStore = {
  state,
  
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
