## TASK-021 — Loại file tạm và backup của app khỏi watcher

**State:** Done
**Current Step:** Completed
**Phase:** Phase 1
**Source ID:** 1A.6

### Description
Đề xuất từ mục 1A.6 trong tài liệu nguồn. Các claim lỗi và số liệu cần được đối chiếu với hiện trạng trước khi sửa; đây chưa phải kết quả xác minh hoặc quyết định thiết kế đã được duyệt.

### Scope
- src-tauri/src/fs_layer/watcher.rs
- src/features/filesystem/
- watcher integration tests
- src-tauri/src/fs_layer/owned_artifacts.rs and src-tauri/src/fs_ops.rs (shared recognition/tree listing)

### Related
- [Kế hoạch duyệt, gates và ràng buộc chung](../plans/collectives-fix-rebuild-review.md)
- [Bản lưu tài liệu nguồn](../plans/collectives-fix-rebuild-source-2026-10-18.md) → 1A.6

### Dependencies
Gate P0; [TASK-017](./TASK-017.md), [TASK-019](./TASK-019.md)

### Requirements
- [x] Watcher bỏ qua file tạm và backup do chính app tạo (`*.tmp-*`, `.*.collectives-backup-*`).

### Acceptance / Verification plan
Save 100 lần trong folder-ref đang watch: 0 event created hoặc deleted cho file tạm, không có entry lạ trong cây.

Các lệnh và phép kiểm tra ở đây dành cho lúc task được duyệt và thực hiện. Ngưỡng nào được nguồn ghi là đề xuất thì cần chốt theo baseline. Nếu claim đã hết đúng, ghi bằng chứng và điều chỉnh task trước khi sửa.

### Steps
- [x] Step 1 — Đối chiếu mục 1A.6 với hiện trạng; kiểm tra phụ thuộc → verify: ghi file/log/fixture hoặc quyết định còn thiếu.
- [x] Step 2 — Thực hiện phạm vi đã được duyệt → verify: đạt Requirements và các ràng buộc chung.
- [x] Step 3 — Nghiệm thu và cập nhật ledger → verify: đáp ứng Acceptance bằng bằng chứng thực chạy hoặc xác nhận được ghi rõ.

### Handoff
- Branch: main; base: 389cb49.
- Next action: TASK-022 orphan cleanup using the same exact name predicate.
- Blockers: none.

### Verification
Windows / Rust 1.99.0: three new ownership/watcher tests pass, including 100 real writes observed by native notify. Raw staging events were present, filtered legacy/v2 output contained no internal path, and tree listing hid a planted owned backup while retaining a similarly named user file. Publication rename retains the real file as modified. All-target compilation and Clippy -D warnings pass; existing watcher suites also pass.

### Log
- 2026-10-18 — Tạo đề xuất Pending từ tài liệu nguồn; chưa triển khai.


- 2026-10-19 — Started by direct next-two request; Windows tests authorized. Inspected current writers: note.tmp-UUID, .note.collectives-backup-UUID, and .note.collectives-UUID.tmp are all app-owned patterns. Filter real publication paths separately so a save still refreshes the real note.

- 2026-10-19 — Implemented shared canonical-v4-UUID predicate, native callback/delivery filtering and folder-list exclusion. Real note publication remains visible; task complete after Windows checks.

- 2026-10-19 — Final ownership review: filenames themselves may contain .tmp-; validate all three complete patterns independently rather than short-circuiting on an invalid earlier suffix.
