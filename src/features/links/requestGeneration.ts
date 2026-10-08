export function createRequestGeneration() {
  let generation = 0;
  return {
    next() {
      generation += 1;
      return generation;
    },
    isCurrent(value: number) {
      return value === generation;
    },
    cancel() {
      generation += 1;
    },
  };
}
