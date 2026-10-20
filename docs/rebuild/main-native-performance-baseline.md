# Native Windows Performance Baseline

- **Baseline date:** 2026-10-20
- **Purpose:** Phase A, before Phase B optimization
- **Result:** The local Windows release benchmark and selected backend coverage matrix pass. This records the current application baseline; it does not claim that future optimization budgets are already met or that GitHub Actions has passed.

## Runs and retained evidence

| Run | Purpose | Result |
|---|---|---|
| `phase0-20261020030924812-30fa901-6ebc5c8c` | Standard frontend, backend, and two-session native release measurements | Pass |
| `phase0-20261020032532283-30fa901-f7a99994` | Smoke backend coverage | Pass |
| `phase0-20261020032700251-30fa901-54adba81` | Large backend coverage | Pass |

Raw JSON, Vitest output, build logs, process-monitor samples, and fixture metadata are retained under the corresponding run folders in `artifacts/phase0/`. The benchmark artifact verifier accepted the selected standard/smoke/large release matrix with `--require-release`.

The selected coverage matrix observed collection sizes 100, 1,000, and 10,000; index sizes 10,000, 25,000, and 50,000; I/O sizes 10 KiB, 1 MiB, and 10 MiB; and a 1,000-entry trusted archive. All selected benchmark artifacts reported status `pass` and exit code 0.

## Machine and toolchain

| Item | Value |
|---|---|
| Operating system | Windows 11 Pro, build 26300 (`Windows_NT` 10.0.26300), x64 |
| CPU | Intel Core i7-9750H @ 2.60 GHz, 12 logical CPUs |
| Installed RAM | 16,965,091,328 bytes (15.8 GiB) |
| WebView2 | 155.0.4283.62 |
| Node.js / npm | v24.20.0 / 11.19.0 |
| Local Rust / Cargo | rustc 1.99.0 MSVC / cargo 1.99.0 |
| Hosted workflow Rust pin | 1.97.0 |
| Application source revision | `30fa901ab1b1eaa5297c29d1ab931d6687d1cb04` |

The Tauri application and backend sources were unchanged from the recorded revision. Benchmark scripts and workflow files were under active development in the working tree; the artifact provenance stores their binary-diff fingerprint. The Cargo manifest content hash is `c66e2b73d6a920e1ca1663755a047b9ae1e3ef564671b95a5c58ef8b2ccc0ac4`, and its binary diff from the recorded revision was empty.

## Reproducible fixtures

All fixture profiles used seed `phaseA-task007-v1`. Each profile was generated into two independent output roots and passed `verify-fixtures` with an exact content and manifest match.

| Profile | Files | Content root SHA-256 | Manifest SHA-256 |
|---|---:|---|---|
| Smoke | 3,113 | `dd10d30f23f644aa651c20d6ff09216f63b1a53a90b16b5e4d011fdb4b155c7c` | `66d553f8a8732ee46d33c9cb45ede68b6f883e1cac1b1557ace55db012d776e6` |
| Standard | 1,005 | `05bbd00cf8daa3267372efa3d0301f535456d0ae3c0967d05fc859cb7b33c5a4` | `50faf84d6efdf4b5b0726d94d188b6a62fb4c0032b69515d9028063b295265b3` |
| Large | 10,005 | `c2d987c7d5a35c125bf6d142a62e711b6a9d1da01c73fc5fcc2b073f6bd800e9` | `36c1a58068d3b59ea53e6f9997b7834306725ae09442279e1fe6ebbec93f4d38` |

## Measurement method

- The native UI measurements ran in two separately built Windows Tauri release sessions. Each session had its own Tauri identifier, app-data directory, native process, and WebView2 user-data profile. The existing production profile was not used.
- Startup samples measured process launch through native WebView2 content readiness. Each session recorded five cold process launches and ten warm process launches. The first cold launch in each session used newly seeded app data; “cold” does not mean that the Windows OS disk cache was cleared.
- The UI workload driver controlled the actual Windows Tauri WebView2 through its debugging endpoint and Playwright/CDP. UI latency is measured from the WebView input/operation to two animation frames. Whole Tauri plus WebView2 process-tree RSS and per-PID CPU deltas were sampled by PowerShell at 100 ms intervals around the operation; CPU windows therefore have up to one sampling interval of boundary quantization.
- Thirteen native UI workloads recorded five measured samples in each session (ten total per workload). The 50-cycle lifetime proxy recorded one 50-cycle sample in each session (two total). Percentiles use nearest-rank `ceil(p × n)` as stored in the raw artifacts.
- UI workloads ran sequentially in one app session. Process-tree RSS is the total resident memory observed during each operation window, not incremental memory attributable only to that operation; earlier loaded data may remain resident. Session peaks therefore also appear in the report.
- Both app sessions requested graceful close with `WM_CLOSE`, exited with code 0, had no forced termination, and left no app/WebView2 process IDs behind.
- The two frontend Vitest benchmark suites are algorithm/jsdom/synthetic proxies. Their wall-clock suite durations below are not native UI latency and are not used to claim native completion.

## Native startup

Each cell is p50 / p95. RSS values are MiB (1 MiB = 1,048,576 bytes); “ready RSS” is the sampled process-tree RSS at or after content readiness, while “window peak” is the highest sampled tree RSS during the launch-to-ready window.

| Session | Mode | n | Startup ms | CPU seconds | Ready RSS MiB | Window peak RSS MiB |
|---|---|---:|---:|---:|---:|---:|
| 1 | Cold process launch | 5 | 5,030 / 5,178 | 5.70 / 5.81 | 371.0 / 377.5 | 334.0 / 337.0 |
| 1 | Warm process launch | 10 | 4,955 / 5,027 | 5.47 / 5.69 | 367.2 / 371.2 | 309.9 / 326.8 |
| 2 | Cold process launch | 5 | 5,134 / 5,664 | 6.05 / 6.44 | 372.7 / 378.3 | 336.1 / 339.1 |
| 2 | Warm process launch | 10 | 4,907 / 5,060 | 5.59 / 5.84 | 367.6 / 371.7 | 315.9 / 332.4 |

After the idle settling window, endpoint process-tree RSS was 421.1 MiB in session 1 and 417.0 MiB in session 2. Full-session sampled process-tree peaks were 2.50 GiB RSS / 2.30 GiB private bytes in session 1 and 2.27 GiB RSS / 2.08 GiB private bytes in session 2.

## Native UI workloads

Elapsed time and CPU are p50 / p95; process-tree peak RSS is p50 / p95 in MiB. All rows passed with zero measured operation errors. The lifetime proxy has two samples; every other workload has ten.

| Workload | n | Elapsed ms | CPU seconds | Peak tree RSS MiB | Errors |
|---|---:|---:|---:|---:|---:|
| Editor typing, 100 KiB | 10 | 62.9 / 69.2 | 0.20 / 0.42 | 471.8 / 488.3 | 0 |
| Editor typing, 1 MiB | 10 | 252.2 / 263.3 | 0.58 / 0.73 | 559.8 / 581.6 | 0 |
| Collection render, 100 entries | 10 | 136.2 / 153.5 | 0.47 / 0.81 | 557.6 / 568.0 | 0 |
| Collection render, 1,000 entries | 10 | 307.5 / 410.6 | 1.77 / 2.13 | 716.2 / 825.4 | 0 |
| Collection render, 10,000 entries | 10 | 1,992.3 / 2,954.7 | 8.05 / 20.06 | 2,052.9 / 2,433.3 | 0 |
| Name search, 100 Markdown files | 10 | 36.3 / 84.3 | 3.30 / 4.17 | 2,313.0 / 2,538.0 | 0 |
| Content search, 100 Markdown files | 10 | 68.0 / 151.7 | 0.55 / 0.91 | 2,329.1 / 2,552.8 | 0 |
| Name search, 2,000 Markdown files | 10 | 35.1 / 36.5 | 0.50 / 0.80 | 2,309.4 / 2,536.2 | 0 |
| Content search, 2,000 Markdown files | 10 | 734.5 / 753.5 | 0.81 / 0.95 | 1,182.2 / 1,214.3 | 0 |
| Watcher burst, 100 files | 10 | 378.5 / 393.3 | 0.13 / 0.20 | 1,186.8 / 1,190.5 | 0 |
| Watcher burst, 1,000 files | 10 | 928.7 / 961.6 | 0.98 / 1.08 | 1,171.1 / 1,196.9 | 0 |
| Chart reopen cycle | 10 | 367.8 / 485.5 | 0.81 / 1.23 | 1,041.9 / 1,053.2 | 0 |
| Table reopen cycle | 10 | 234.9 / 252.0 | 0.48 / 1.25 | 1,013.5 / 1,037.1 | 0 |
| Editor open/close, 50-cycle lifetime proxy | 2 | 11,061.5 / 11,745.2 | 12.64 / 24.67 | 1,015.9 / 1,041.0 | 0 |

The 50-cycle proxy recorded settled end-minus-start RSS changes of −261.1 MiB and −238.5 MiB in the two sessions. There is no separate lightweight popup window in the current application, so this is explicitly an editor open/close proxy. With only two proxy samples, this is baseline evidence rather than a guarantee about longer-running sessions.

## Backend release coverage

The backend harness reports per-operation elapsed time and peak RSS; it does not report per-operation CPU. Each workload below has five release samples and zero failed operations. Peak RSS is MiB.

| Profile | Workload | n | Elapsed ms p50 / p95 | Peak RSS MiB p50 / p95 | Errors |
|---|---|---:|---:|---:|---:|
| Smoke | Collection JSON load/mutation (100 entries) | 5 | 68.4 / 71.4 | 5.0 / 5.1 | 0 |
| Smoke | SQLite link-index rebuild/search (10,000 entries) | 5 | 61.3 / 73.9 | 12.3 / 12.4 | 0 |
| Smoke | Temporary file read/write (10 KiB) | 5 | 6.2 / 6.8 | 4.6 / 4.6 | 0 |
| Standard | Collection JSON load/mutation (1,000 entries) | 5 | 85.0 / 86.5 | 6.0 / 6.2 | 0 |
| Standard | SQLite link-index rebuild/search (25,000 entries) | 5 | 124.4 / 131.6 | 21.2 / 21.2 | 0 |
| Standard | Temporary file read/write (1 MiB) | 5 | 7.1 / 7.6 | 6.2 / 6.3 | 0 |
| Standard | Trusted ZIP export/import (1,000 entries) | 5 | 6,323.4 / 6,458.9 | 8.5 / 8.9 | 0 |
| Large | Collection JSON load/mutation (10,000 entries) | 5 | 106.7 / 141.2 | 16.5 / 16.6 | 0 |
| Large | SQLite link-index rebuild/search (50,000 entries) | 5 | 217.5 / 228.5 | 35.7 / 35.7 | 0 |
| Large | Temporary file read/write (10 MiB) | 5 | 13.1 / 15.5 | 24.2 / 24.2 | 0 |

## Frontend proxy suite wall time

These measurements time the Vitest benchmark suite invocation and are included only as synthetic/jsdom regression context.

| Suite | n | Wall time ms p50 / p95 | Status |
|---|---:|---:|---|
| Phase 0 frontend algorithm/jsdom suite | 5 | 9,248 / 9,360 | Pass |
| Phase 6 UI-latency synthetic/jsdom suite | 5 | 7,564 / 7,608 | Pass |

## Hotspots and DEC-PERF-01 budgets

The highest measured native UI costs by p95 latency were: the 50-cycle editor lifetime proxy at 11.75 s (n=2); 10,000-entry collection render at 2.95 s (n=10); 1,000-file watcher burst at 961.6 ms (n=10); and content search over 2,000 files at 753.5 ms (n=10). The 10,000-entry render reached 2,433.3 MiB p95 process-tree RSS. The high search RSS values follow earlier large-tree workloads in the same session and should be read as whole-process-tree totals, not isolated per-operation allocations.

| Budget for later refactors | Acceptance target | Baseline observation |
|---|---|---|
| 1 MiB Markdown typing input-to-paint | Final optimized p95 ≤ 120 ms | 263.3 ms p95; baseline is 2.19× the target and gives Phase B a measurable target |
| Cold start | Optimized median ≤ baseline × 1.20 | Baselines are recorded per session in the startup table |
| Settled idle process-tree RAM | Optimized ≤ baseline × 1.15 + 10 MiB | Endpoints: 421.1 MiB and 417.0 MiB |
| Targeted workload regression | No targeted p95 regression > 15%; aim for ≥10% reduction in significant hot-path work | Compare against the raw per-workload p95 table |
| 50-cycle settled lifetime proxy | Persistent RAM growth ≤ 30 MiB above warmed settled level | −261.1 MiB and −238.5 MiB in two proxy windows; small n, not a long-duration leak guarantee |
| Data integrity errors | 0 | Benchmark workloads reported 0 operation errors; the separate Phase A data-integrity tasks provide the broader safety evidence |

These are project acceptance budgets established before Phase B optimization. They are not claims that the current application has already passed every optimized-build gate. Linux and macOS were not measured; their work remains paused under DEC-013. GitHub Actions execution is handled separately and is not claimed as passing by this local report.
