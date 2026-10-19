## TASK-017 — Dọn file tạm trên mọi lỗi trước commit

**State:** Done
**Current Step:** Completed
**Phase:** Phase 1
**Source ID:** 1A.2

### Description
Đề xuất từ mục 1A.2 trong tài liệu nguồn. Các claim lỗi và số liệu cần được đối chiếu với hiện trạng trước khi sửa; đây chưa phải kết quả xác minh hoặc quyết định thiết kế đã được duyệt.

### Scope
- src-tauri/src/repositories/documents.rs
- filesystem fault-injection tests

### Related
- [Kế hoạch duyệt, gates và ràng buộc chung](../plans/collectives-fix-rebuild-review.md)
- [Bản lưu tài liệu nguồn](../plans/collectives-fix-rebuild-source-2026-10-18.md) → 1A.2

### Dependencies
Gate P0; [TASK-016](./TASK-016.md)

### Requirements
- [x] Dọn file tạm trên mọi đường lỗi: guard RAII xóa `*.tmp-<uuid>` khi `write_all`, `sync_all`, kiểm tra CAS hoặc rename thất bại.

### Acceptance / Verification plan
Tiêm lỗi ở từng bước: sau mỗi lần, thư mục không còn `*.tmp-*` và bytes của file gốc không đổi.

Các lệnh và phép kiểm tra ở đây dành cho lúc task được duyệt và thực hiện. Ngưỡng nào được nguồn ghi là đề xuất thì cần chốt theo baseline. Nếu claim đã hết đúng, ghi bằng chứng và điều chỉnh task trước khi sửa.

### Steps
- [x] Step 1 — Đối chiếu mục 1A.2 với hiện trạng; kiểm tra phụ thuộc → verify: ghi file/log/fixture hoặc quyết định còn thiếu.
- [x] Step 2 — Thực hiện phạm vi đã được duyệt → verify: đạt Requirements và các ràng buộc chung.
- [x] Step 3 — Nghiệm thu và cập nhật ledger → verify: đáp ứng Acceptance bằng bằng chứng thực chạy hoặc xác nhận được ghi rõ.

### Handoff
- Branch: `main`
- Base commit: `110bc56` (mốc phân rã kế hoạch)
- Uncommitted files: bộ tài liệu Pending; chưa có thay đổi triển khai cho task này.
- Next action: Người dùng duyệt TASK-017; khi bắt đầu, kiểm tra lại git và Dependencies, rồi làm Step 1.
- Blockers: chờ duyệt và các phụ thuộc chưa hoàn tất.

### Verification
Chưa triển khai; chưa chạy test sản phẩm. Các tiêu chí nghiệm thu chưa được xác nhận đạt.

### Log
- 2026-10-18 — Tạo đề xuất Pending từ tài liệu nguồn; chưa triển khai.


- 2026-10-19 — Started explicit next-five scope after TASK-016 implementation; Windows-only.

- 2026-10-19 — Implemented owned temporary-file RAII: only successfully created files are owned; handle closes before deletion even on write/flush/CAS/rename failure. Windows Rust 1.99 cargo fmt/check --lib pass. Fault-injection acceptance awaits test authorization.

- 2026-10-19 — Windows Rust 1.99 fault-injection regression passes all four precommit boundaries (write, sync, CAS, replace); after each injected error only the original unchanged note remains. User authorized tests; task Done.
