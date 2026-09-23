import { bench, describe } from "vitest";

function renderSyntheticCollection(size: number): number {
  const rows = Array.from({ length: size }, (_, index) => ({ id: `entry-${index}`, label: `Note ${index}` }));
  return rows.reduce((total, row) => total + row.label.length, 0);
}

describe("Phase 6 UI latency synthetic baseline", () => {
  bench("1k collection render", () => { void renderSyntheticCollection(1_000); });
  bench("10k collection render", () => { void renderSyntheticCollection(10_000); });
  bench("1MB text-source update", () => { void "x".repeat(1_024 * 1_024).slice(0, 16); });
});
