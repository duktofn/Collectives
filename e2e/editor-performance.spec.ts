import { expect, test } from "@playwright/test";

test("measures 1 MiB CodeMirror input-to-paint with and without the prior full-string work", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/e2e/editor-interaction.html", { waitUntil: "load" });
  const measurement = await page.evaluate(async () => {
    const content = `# Performance fixture\n\n${Array.from({ length: 700 }, () => "A representative Markdown paragraph with enough text to exercise visible-line layout, parsing, and decoration updates. ".repeat(13)).join("\n\n")}`;
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;background:var(--bg-primary);";
    document.body.append(host);
    const fixture = await import("/src/visual-fixtures/editorPerformanceFixture.tsx");
    const measure = async (legacyStringCopies: number) => {
      const mounted = await fixture.mountEditorPerformanceFixture(host, content);
      const view = mounted.view;
      const sample = async () => {
        const from = view.state.doc.length;
        const started = performance.now();
        view.dispatch({ changes: { from, to: from, insert: "x" }, selection: { anchor: from + 1 } });
        for (let copy = 0; copy < legacyStringCopies; copy += 1) view.state.doc.toString();
        const synchronousMs = performance.now() - started;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        return { synchronousMs, inputToPaintMs: performance.now() - started };
      };
      for (let index = 0; index < 5; index += 1) await sample();
      const samples: Array<{ synchronousMs: number; inputToPaintMs: number }> = [];
      for (let index = 0; index < 20; index += 1) samples.push(await sample());
      await mounted.dispose();
      return samples;
    };
    const legacy = await measure(2);
    const current = await measure(0);
    const measureOpenSwitch = async () => {
      const mounted = await fixture.mountEditorPerformanceFixture(host, content);
      const samples: number[] = [];
      for (let index = 0; index < 5; index += 1) await mounted.switchPath(`C:/performance/switch-${index % 2}.md`);
      for (let index = 0; index < 20; index += 1) {
        const started = performance.now();
        await mounted.switchPath(`C:/performance/switch-${index % 2}.md`);
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        samples.push(performance.now() - started);
      }
      await mounted.dispose();
      return samples;
    };
    const switchSamples = await measureOpenSwitch();
    const summarize = (samples: Array<{ synchronousMs: number; inputToPaintMs: number }>) => {
      const paint = samples.map((sample) => sample.inputToPaintMs);
      const synchronous = samples.map((sample) => sample.synchronousMs);
      const sorted = [...paint].sort((left, right) => left - right);
      const syncSorted = [...synchronous].sort((left, right) => left - right);
      return {
        inputToPaintSamplesMs: paint.map((value) => Number(value.toFixed(2))),
        synchronousSamplesMs: synchronous.map((value) => Number(value.toFixed(2))),
        p50Ms: Number(sorted[Math.floor(sorted.length / 2)]!.toFixed(2)),
        p95Ms: Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!.toFixed(2)),
        synchronousP95Ms: Number(syncSorted[Math.min(syncSorted.length - 1, Math.ceil(syncSorted.length * 0.95) - 1)]!.toFixed(2)),
      };
    };
    const summarizeNumbers = (samples: number[]) => {
      const sorted = [...samples].sort((left, right) => left - right);
      return {
        samplesMs: samples.map((value) => Number(value.toFixed(2))),
        p50Ms: Number(sorted[Math.floor(sorted.length / 2)]!.toFixed(2)),
        p95Ms: Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!.toFixed(2)),
      };
    };
    return {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      viewport: { width: innerWidth, height: innerHeight },
      utf8Bytes: new TextEncoder().encode(content).length,
      legacyDoubleSerialize: summarize(legacy),
      currentLazyMaterialize: summarize(current),
      openSwitch: summarizeNumbers(switchSamples),
    };
  });
  console.log(`CODEMIRROR_PERFORMANCE_EVIDENCE ${JSON.stringify(measurement)}`);
  expect(measurement.utf8Bytes).toBeGreaterThan(1_000_000);
  expect(measurement.legacyDoubleSerialize.inputToPaintSamplesMs).toHaveLength(20);
  expect(measurement.currentLazyMaterialize.inputToPaintSamplesMs).toHaveLength(20);
  expect(measurement.openSwitch.samplesMs).toHaveLength(20);
});

