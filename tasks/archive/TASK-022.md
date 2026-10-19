## TASK-022 — Dọn file mồ côi của app cũ hơn 24 giờ

**State:** Paused
**Current Step:** Paused by user before implementation publication
**Phase:** Phase 1
**Source ID:** 1A.7

### Description
Đề xuất từ mục 1A.7 trong tài liệu nguồn. Các claim lỗi và số liệu cần được đối chiếu với hiện trạng trước khi sửa; đây chưa phải kết quả xác minh hoặc quyết định thiết kế đã được duyệt.

### Scope
- src-tauri/src/repositories/documents.rs
- src-tauri/src/application/services.rs (collection-open initialization via canonical repository)
- filesystem integration tests

### Related
- [Kế hoạch duyệt, gates và ràng buộc chung](../plans/collectives-fix-rebuild-review.md)
- [Bản lưu tài liệu nguồn](../plans/collectives-fix-rebuild-source-2026-10-18.md) → 1A.7

### Dependencies
Gate P0; [TASK-017](./TASK-017.md), [TASK-019](./TASK-019.md)

### Requirements
- [ ] Khi mở collection, xóa file mồ côi cũ hơn 24 giờ khớp đúng pattern và uuid của app.

### Acceptance / Verification plan
Tạo sẵn file mồ côi cũ, file mồ côi mới và file người dùng tên gần giống: chỉ file cũ khớp pattern bị xóa.

Các lệnh và phép kiểm tra ở đây dành cho lúc task được duyệt và thực hiện. Ngưỡng nào được nguồn ghi là đề xuất thì cần chốt theo baseline. Nếu claim đã hết đúng, ghi bằng chứng và điều chỉnh task trước khi sửa.

### Steps
- [ ] Step 1 — Đối chiếu mục 1A.7 với hiện trạng; kiểm tra phụ thuộc → verify: ghi file/log/fixture hoặc quyết định còn thiếu.
- [ ] Step 2 — Thực hiện phạm vi đã được duyệt → verify: đạt Requirements và các ràng buộc chung.
- [ ] Step 3 — Nghiệm thu và cập nhật ledger → verify: đáp ứng Acceptance bằng bằng chứng thực chạy hoặc xác nhận được ghi rõ.

### Handoff
- Branch: main; base: 4ffe8af.
- Source changes reverted at the user's instruction to do only TASK-021.
- Draft patch saved locally: artifacts/task022-deferred.patch.
- Next action: resume only if explicitly requested; re-evaluate the draft before using it.
- Blockers: intentionally deferred by user.

### Verification
Chưa triển khai; chưa chạy test sản phẩm. Các tiêu chí nghiệm thu chưa được xác nhận đạt.

### Log
- 2026-10-18 — Tạo đề xuất Pending từ tài liệu nguồn; chưa triển khai.


- 2026-10-19 — Started after TASK-021 commit 4ffe8af. Windows tests authorized. Cleanup will use exact ownership predicate and >24h modified age, avoid reparse/symlink directories and explicit collection file references, and retain new/future-dated/similar user files.

- 2026-10-19 — User narrowed request to TASK-021 only and replacement logo. Stopped TASK-022, saved draft patch and reverted its two source files; no cleanup code retained or executed.
