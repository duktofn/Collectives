# UX and performance improvements

Further editor correction: [Code click drift — 2026-10-06](code-click-drift-2026-10-06.md), including height-aware fence hiding and the sidebar expand control in the header layout.

Latest follow-up: [Island UI and Write interaction — 2026-10-06](islands-editor-update-2026-10-06.md). Pin/Recent were subsequently removed at the user's request; the checklist below records the earlier implementation.

The subsequent visual and interaction refinement is recorded in [UX polish — 2026-10-06](ux-polish-2026-10-06.md), including sidebar/search discovery, responsive toolbars, collection overview, folder defaults, keyboard menus and browser evidence.

Implementation record for the requested Collectives UX and performance work. The existing user changes in editor, settings, IPC, Rust, table, code-block and E2E files were preserved; implementation was applied around them.

## Scope checklist

- [x] Recovery and conflict safety: moved-file choices, Save a copy, compare/recheck, reload/discard wording, bounded crash drafts.
- [x] Daily workflows: New note, Quick Open, collection-scoped content search, Recent/Pinned, Back/Forward, per-document cursor and scroll.
- [x] Shell and navigation: top collection picker, Collectives welcome copy, group/folder context, header navigation and secondary actions, explicit save status.
- [x] Reading and linking: closed-by-default Outline/Backlinks panel, missing-link creation, bounded preview, slash templates and menu insertion, truthful settings tabs.
- [~] Performance: removed full document serialization from each CodeMirror document update and replaced chart line scans with parser-tree traversal. Sidebar row virtualization remains unimplemented.

## Implementation decisions

- The revisioned save queue, write receipt token, CAS overwrite, selection save barrier and EditorState reset on document changes were already present. Conflict overwrite now requires a disk version that was compared in the UI and rechecks that token before the write.
- Save a copy and New note use `create_file`, which publishes by same-folder hard link where supported and falls back to exclusive `create_new`; an existing destination is never replaced. New note asks for a physical folder, appends `.md`, and adds the reference under the selected virtual group when applicable.
- Recovery snapshots use local app storage, keep at most eight drafts, cap a draft at 2 MiB and total content at 6 MiB, and debounce live-buffer reads for 900 ms. A matching persisted version is cleaned at startup; external or missing originals are restored as conflicts. Explicit discard removes that recovery snapshot.
- Full-text search is a bounded Rust background scan over Markdown paths from the SQLite metadata name index and referenced folders. It reads current disk bytes on demand, debounces typing in the UI, returns snippets/UTF-16 offsets and pages up to 100 results. The scan caps at 2,000 files, 64 MiB total, and 10 MiB per file. It reflects edits, renames and deletions on the next query without an incremental body index.
- Recent, pins, collapse state and recovery data are collection-scoped in local storage. Back/Forward stays in bounded session memory (50 entries per collection); CodeMirror cursor and scroll state is bounded to 24 paths.
- Outline uses CodeMirror’s syntax tree. Backlinks search the literal `[[note name` prefix in the active collection only when opened or refreshed. Missing links are offered for creation only when resolution returns no match; index/access failures show an error. Hover/F1 previews display plain text capped at 700 characters and do not recursively render links.
- Slash autocomplete and the Insert menu provide heading, checklist, table, code and chart templates. Insertion is one CodeMirror transaction and is refused in code blocks, inline code and read-only documents.
- Settings expose Appearance, Files & Storage and Shortcuts because each has a real control or working shortcut. No empty Editor settings tab was added. Color overrides are collapsed under Advanced; the existing draft/apply/cancel behavior remains.

## Validation

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npm run build`: pass; lazy-loading Quick Open, content search and recovery overlays reduced the largest chunk from 886.91 kB to 880.91 kB (288.84 kB gzip). Vite still warns that this exceeds its 500 kB advisory.
- Targeted frontend regressions: 53 tests passed, covering save copy, disk-token changes after compare, missing-file recovery, per-update serialization, moved-file deferral, group note placement, template Undo/code protection, Quick Open keyboard use, stale-request invalidation, WikiLink missing/error separation, recovery coalescing, theme settings and Editor transitions.
- Full frontend suite: 164 tests passed; three tests in `scripts/phase5/resolve-predecessors.test.mjs` failed before reaching their assertions because the fixed predecessor fixture directory `artifacts/phase6/phase6-20260825-code3-rev2` is absent. The errors are `ENOENT` from `mkdtemp`.
- Targeted Playwright editor/code/table regression run: 11 of 12 passed. The remaining existing selection-history test expected `cm-editor` to lose `cm-focused` after calling `contentDOM.blur()`, but it remained focused in headless Chromium. Code-block and table interaction cases passed.
- The existing Solid browser harness rendered 10,000 rows successfully. That test checks the state transition and row count only; it does not provide a sidebar latency sample.
- Existing Phase 6 Playwright accessibility emulation passed both the 800×600 shell/live-region case and the 1024×768 forced-colors/reduced-motion case.
- Rust: `cargo check` and the full `cargo test --manifest-path src-tauri/Cargo.toml` passed, including the 25 library tests, all integration suites, and four watcher-stress tests. Windows linker emitted the existing `LNK4098` runtime-library warning.
- IPC: `node scripts/ipc/generate-contracts.mjs --check` and `node scripts/ipc/verify-handler-registry.mjs` passed with 39 commands.

## Browser performance evidence and limits

Two independent Playwright Chromium runs used Windows 10 x64, HeadlessChrome 151.0.7922.34, 12 reported logical cores, a 1280×800 dark viewport, a 1,084,321-byte Markdown fixture split into paragraphs, five warmups and twenty retained samples. Input-to-paint p95 was 17.4 ms and 17.5 ms for the current editor path; open/switch p95 was 34.1 ms and 34.2 ms. Both browser results are below the proposed 50 ms editor budget.

The same fixture compared the current listener with two explicit full-document `toString()` calls to model the old per-keystroke work. The paired p95 values were 17.6/17.2 ms with those calls and 17.4/17.5 ms without them. The difference is within frame timing and measurement noise, so this experiment did not show a reliable input-to-paint reduction. The source no longer performs either serialization per key; a direct native Tauri/WebView comparison is still required to establish a production improvement. Search latency, actual sidebar latency and process-tree memory cycles were not measured in this browser run. Rust watcher correctness/stress tests passed, but native event-to-visible latency is not measured.

## Remaining limitations

- Search content is read from disk in bounded background scans rather than an incremental SQLite full-text body index. A sufficiently large collection may reach the documented scan cap; the UI reports truncation.
- Backlinks refresh on panel open, document change, or explicit refresh; watcher changes to closed notes are reflected on refresh.
- The production sidebar still renders the active collection tree as Solid components. The 10,000-row browser fixture is a state-transition smoke check, not evidence for a virtualized sidebar or a large-tree latency budget.
- The measured Playwright fixture is not the native Tauri WebView. Startup/memory process-tree metrics and native watcher UI latency remain unavailable here.
- Startup now tries the most recent readable note in the same collection when the last selected file is missing. If no recent file is readable, it surfaces the original read error; recovery review handles local crash drafts separately.
