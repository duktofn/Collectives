# Phase 0 baseline contract

Phase 0 establishes reproducible quality and measurement evidence for the SolidJS/CodeMirror + Tauri/Rust rebuild. It does not change archive-import safety, editor save/open semantics, group-delete atomicity, settings schema, index/watcher behavior, UI accessibility, or data migrations.

## Pinned toolchain and gates

- Node is pinned by `.nvmrc` to `20.19.0`.
- Rust, rustfmt, and clippy are pinned by `rust-toolchain.toml` to `1.97.0`.
- The canonical entrypoints are `node scripts/phase0/verify-quality.mjs frontend` and `node scripts/phase0/verify-quality.mjs backend`.
- Backend verification keeps `cargo test --locked --all-targets`; the benchmark binary is only invoked explicitly by `run-benchmarks.mjs`.

## Fixtures

`test-fixtures/phase0/manifest.json` defines smoke, standard, and large profiles. Generation requires a fixed seed, a new non-empty output path, sufficient free space, and a safe non-symlink root outside the workspace/app-data roots. The generator does not delete or clean up directories. Each generated fixture contains deterministic per-file SHA-256 values, a content-root SHA-256, watcher-shape lists, and a trusted ZIP with safe paths. Traversal, malicious ZIP, fault, and rollback fixtures are intentionally deferred to Phase 1.

Generate two independent roots and compare them with:

```text
node scripts/phase0/generate-fixtures.mjs --out <new-dir-a> --profile large --seed phase0-v1
node scripts/phase0/generate-fixtures.mjs --out <new-dir-b> --profile large --seed phase0-v1
node scripts/phase0/verify-fixtures.mjs --left <new-dir-a> --right <new-dir-b> --manifest test-fixtures/phase0/manifest.json
```

## Benchmark boundary

The frontend benchmark is wired through the `phase0:frontend-bench` package script and Vitest bench. Labels are `pure-algorithm` and `jsdom-proxy`; they are not native WebView or UI-visible performance claims. The Rust binary at `src-tauri/src/bin/phase0_bench.rs` is an explicit `cargo run --locked --release --bin phase0_bench` target and measures the product manager, link-index, temporary I/O, and collection archive APIs. Standard complete evidence retains trusted ZIP export/import at the 1k-entry profile; separate large backend coverage proves manager 10k and link-index 50k. The large trusted archive path is intentionally not used as a Phase 0 SLO because the existing importer’s per-entry lookup cost is Phase 1/3 debt.

The native collector measures only launch-to-stable owned process-tree time and sampled peak private/RSS memory. It sets child-only `APPDATA`, `LOCALAPPDATA`, and `XDG_*` roots for every sample, waits after WM_CLOSE/SIGTERM, and verifies the owned tree is gone before the next sample; forced cleanup fails the run. Backend samples are controller-merged from one fresh worker child per timed operation, with memory scope recorded as `per-child-operation`. Backend memory uses an OS peak counter (`PeakWorkingSet64` on Windows or `VmHWM` on Linux). Missing isolation, cleanup, finite samples, or complete sample counts blocks the performance run. Build time, renderer readiness, and WebView interaction latency are excluded.

Selected smoke/standard/large coverage proves manager 1k/10k, link-index 10k/50k, and temporary I/O 10KB/1MB/10MB. Standard is the trusted archive export/import baseline; large archive import remains a bounded Phase 1/3 cost probe.

All summaries use nearest rank: `rank = ceil(percentile * sample_count)`, one-indexed after ascending sort. Timings are informational; Phase 0 defines no performance SLO.

## Evidence and reconciliation

The harness creates an immutable unique `artifacts/phase0/<UTC-commit-nonce>/` directory. JSON artifacts carry the commit, tracked binary-diff fingerprint, untracked inventory fingerprint, Cargo.toml content/diff fingerprints, tool/system data, fixture checksums, commands, timestamps, and collector source. `capture-worktree.mjs` records preflight/reconciliation state and preserves existing user changes. `verify-artifacts.mjs` validates schema, raw-to-summary consistency, finite samples, provenance, run-id uniqueness, and native cleanup evidence.

Artifacts are locally ignored. The scheduled/manual workflow uploads them for 90 days. `src-tauri/src/collection/archive.rs` is allowed only rustfmt-mechanical changes in this phase; any such change must be reported with a formatting-only diff evidence path.

`node scripts/phase0/run-benchmarks.mjs --self-check-safety` verifies rejected workspace, drive, outside-workspace, and app-data artifact roots. Normal runs accept only `artifacts/phase0` or a validated child with no symlink/reparse component.

Incomplete or failed run directories are preserved and explicitly classified by `verify-artifacts.mjs`. A complete-matrix review must pass `--run-id <id>`; large backend coverage is selected with `--coverage-run-id <id>`. `--allow-incomplete` is reserved for the PR smoke harness, which intentionally skips native startup. Artifacts record whether the backend used canonical `cargo-release` or an explicitly configured local debug binary; only the scheduled/manual CI path is the release baseline.
