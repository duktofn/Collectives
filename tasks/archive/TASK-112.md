# TASK-112 — Fix slow dev startup

**State:** Done
**Scope:** `vite.config.ts`; isolated startup measurement helpers under ignored artifacts.

Vite watched approximately 52,000 generated files and scanned Tauri-generated HTML. Limit dependency scanning to application/test pages and exclude native artifacts, release output and test results from the dev watcher.

## Verification
- Cold UI with a small mocked collection: baseline 78.1/56.2 seconds; entries-only experiment 66.3 seconds; scoped watcher experiment 4.9 seconds. Actual configuration with two fresh caches: 10.5/11.4 seconds under concurrent validation. Watched entries fell to 534; source watching remains active. No page errors.
- Typecheck, lint and production build pass. Full frontend: 321 tests pass with `--maxWorkers=2`, unchanged assertions/timeouts. Default worker count timed out importing GroupNode inside its test; that failure remains recorded in the canonical quality logs.
- Browser: 125/126 passed in the full run; the preset-theme test hit its total 30-second timeout under concurrent load. Both tests in that file passed separately unchanged (theme test 21.7 seconds). Phase 6: 5/5 pass. All 131 distinct browser tests covered successfully; no single clean canonical combined run claimed.
- Evidence: `artifacts/phase0/task112-{baseline,baseline2,scoped-watch,fixed-1,fixed-2}.json`, `task112-unit-bounded.log`, `task112-theme-isolated.log`, `task112-phase6.log`.
- No remote writes or user app-data changes.
- Implementation commit: `13c3716`.
