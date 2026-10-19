## TASK-096 — Import updated logo and regenerate Windows icons

**State:** Done
**Current Step:** Completed

### Description
User replaced C:/Users/ducto/Downloads/Collectives_Logo.svg and asks to import and set it again. Only TASK-021 remains in the preceding plan batch; TASK-022 is paused.

### Scope
src/assets/logo.svg, src-tauri/icons Windows PNG/ICO assets, task/changelog/architecture records.

### Requirements
- [x] Repository SVG matches the latest supplied file and existing UI logo consumers still use it.
- [x] Windows PNG/ICO assets regenerated from that SVG.
- [x] Inspect icon preview and compile/build; commit separately.

### Steps
- [x] Inspect/import latest SVG → verify: matching file hashes.
- [x] Generate Windows icon assets → verify: generated preview and existing consumer paths.
- [x] Build and commit → verify: static checks and focused commit.

### Handoff
- Branch: main; base: 4ffe8af.
- Next action: none; updated SVG and Windows icons ready in the next app build.
- Blockers: none.

### Verification
SHA256 of supplied and imported SVG matches: 2DDE76135AD3DF9120E606BD7D7D17655B17C72B0389BD83BF3CEFBD8B939B8B. New 27×27 source fills the icon canvas; generated 128px PNG visually inspected. Windows PNG/ICO regenerated at existing asset paths. Typecheck and production build passed (existing Vite chunk-size warning). Installed Windows icon cache not exercised.

### Log
- 2026-10-19 — Created and started from explicit updated-logo request.

- 2026-10-19 — Imported latest SVG unchanged; existing favicon/title bar/welcome consumers use this path. Refreshed Windows icons, inspected preview and passed typecheck/build.
