/** Allows theme/layout changes outside the editor to trigger CM6 height remeasure. */
let measureRequest: (() => void) | null = null;

export function registerEditorMeasureRequest(fn: () => void): () => void {
  measureRequest = fn;
  return () => {
    if (measureRequest === fn) {
      measureRequest = null;
    }
  };
}

export function requestEditorMeasure(): void {
  measureRequest?.();
}
