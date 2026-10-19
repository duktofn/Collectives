## TASK-016 — Giữ draft và báo lỗi khi thư mục cha của note đã mất

**State:** Paused
**Current Step:** Step 2 — Reject missing parent without recreating it
**Phase:** Phase 1
**Source ID:** 1A.1

### Description
Đề xuất từ mục 1A.1 trong tài liệu nguồn. Các claim lỗi và số liệu cần được đối chiếu với hiện trạng trước khi sửa; đây chưa phải kết quả xác minh hoặc quyết định thiết kế đã được duyệt.

### Scope
- src-tauri/src/repositories/documents.rs
- src/stores/editor.ts
- contracts/

### Related
- [Kế hoạch duyệt, gates và ràng buộc chung](../plans/collectives-fix-rebuild-review.md)
- [Bản lưu tài liệu nguồn](../plans/collectives-fix-rebuild-source-2026-10-18.md) → 1A.1

### Dependencies
Gate P0

### Requirements
- [ ] Save note đã tồn tại không tạo lại thư mục cha: bỏ `create_dir_all` khỏi `write_file`; thư mục cha mất thì trả lỗi `parent_missing` và giữ draft. File mới chỉ tạo qua `create_file`.

### Acceptance / Verification plan
Xóa thư mục cha rồi `write_file`: kết quả là lỗi, và thư mục cha vẫn không tồn tại sau lệnh.

Các lệnh và phép kiểm tra ở đây dành cho lúc task được duyệt và thực hiện. Ngưỡng nào được nguồn ghi là đề xuất thì cần chốt theo baseline. Nếu claim đã hết đúng, ghi bằng chứng và điều chỉnh task trước khi sửa.

### Steps
- [ ] Step 1 — Đối chiếu mục 1A.1 với hiện trạng; kiểm tra phụ thuộc → verify: ghi file/log/fixture hoặc quyết định còn thiếu.
- [ ] Step 2 — Thực hiện phạm vi đã được duyệt → verify: đạt Requirements và các ràng buộc chung.
- [ ] Step 3 — Nghiệm thu và cập nhật ledger → verify: đáp ứng Acceptance bằng bằng chứng thực chạy hoặc xác nhận được ghi rõ.

### Handoff
- Branch: main; base: 11a2fd2.
- Next action: run missing-parent acceptance when tests are authorized; implementation complete.
- Blockers: runtime regression not run.

### Verification
Chưa triển khai; chưa chạy test sản phẩm. Các tiêu chí nghiệm thu chưa được xác nhận đạt.

### Log
- 2026-10-18 — Tạo đề xuất Pending từ tài liệu nguồn; chưa triển khai.


- 2026-10-19 — Authorized as first of next five tasks after priority fixes. Windows-only scope; CI history is not an implementation dependency.

- 2026-10-19 — Implemented parent_missing check without create_dir_all. Existing frontend catch retains dirty state and draft. Windows Rust 1.99.0 cargo fmt and cargo check --locked --lib passed. Acceptance runtime regression awaits test authorization; implementation committed before TASK-017.
