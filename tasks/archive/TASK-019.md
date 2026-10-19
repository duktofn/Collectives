## TASK-019 — Trả receipt và warning cho lỗi xảy ra sau commit

**State:** Done
**Current Step:** Completed
**Phase:** Phase 1
**Source ID:** 1A.4

### Description
Đề xuất từ mục 1A.4 trong tài liệu nguồn. Các claim lỗi và số liệu cần được đối chiếu với hiện trạng trước khi sửa; đây chưa phải kết quả xác minh hoặc quyết định thiết kế đã được duyệt.

### Scope
- src-tauri/src/repositories/documents.rs
- contracts/
- Windows/unix integration tests

### Related
- [Kế hoạch duyệt, gates và ràng buộc chung](../plans/collectives-fix-rebuild-review.md)
- [Bản lưu tài liệu nguồn](../plans/collectives-fix-rebuild-source-2026-10-18.md) → 1A.4

- [Quyết định đã duyệt trong TASK-005](../../decisions.md) → DEC-003

### Dependencies
Gate P0; [TASK-017](./TASK-017.md), [TASK-018](./TASK-018.md)

### Requirements
- [x] Lỗi sau commit không trả `Err`: dọn backup thất bại (Windows `ReplaceFileW`) hoặc fsync thư mục thất bại (unix) trả `Ok(receipt)` kèm `warnings`. Token trong receipt là blake3 của bytes đã ghi.

- [x] Verify Windows backup cleanup warning; native Unix checks are out of current scope (DEC-013).

### Acceptance / Verification plan
Test trên Windows runner: giữ handle mở trên file backup để `remove_file` thất bại. Kết quả Ok kèm warning `backup_cleanup_failed`, đĩa chứa bản mới, lần save kế tiếp dùng token của receipt và thành công, không có conflict.

Các lệnh và phép kiểm tra ở đây dành cho lúc task được duyệt và thực hiện. Ngưỡng nào được nguồn ghi là đề xuất thì cần chốt theo baseline. Nếu claim đã hết đúng, ghi bằng chứng và điều chỉnh task trước khi sửa.

### Steps
- [x] Step 1 — Đối chiếu mục 1A.4 với hiện trạng; kiểm tra phụ thuộc → verify: ghi file/log/fixture hoặc quyết định còn thiếu.
- [x] Step 2 — Thực hiện phạm vi đã được duyệt → verify: đạt Requirements và các ràng buộc chung.
- [x] Step 3 — Nghiệm thu và cập nhật ledger → verify: đáp ứng Acceptance bằng bằng chứng thực chạy hoặc xác nhận được ghi rõ.

### Handoff
- Branch: main; source and focused regression changes committed locally.
- Next action: none for this task; current requested batch complete.
- Blockers: none within Windows scope.

### Verification
Windows test holds a real backup file handle without delete sharing: committed write returns backup_cleanup_failed warning with exact new-byte hash; next save succeeds with receipt token. Full Rust all-target test run passes. Native Unix behavior was not tested.

### Log
- 2026-10-18 — Tạo đề xuất Pending từ tài liệu nguồn; chưa triển khai.

- 2026-10-18 — TASK-005 đã chốt phạm vi (DEC-003); cập nhật kế hoạch nghiệm thu, task vẫn Pending và chưa triển khai.


- 2026-10-19 — Started receipt warnings under Windows-only scope; native Linux/macOS acceptance paused by user direction.

- 2026-10-19 — Windows Rust 1.99.0: locked real backup handle regression passed; write returned Ok with backup_cleanup_failed, new bytes and exact token, next save with that token succeeded. Receipt warnings also preserve success for existing Unix directory sync branch (not native-tested) and create-file cleanup. Typecheck passed.

- 2026-10-19 — Final Windows verification recorded; source tree passed typecheck/lint/contracts/build, 291 frontend unit tests, 28 related browser tests and the full Rust all-target test run. No remote push or CI configuration change.
