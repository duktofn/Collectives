## TASK-018 — Bắt buộc precondition khi ghi tài liệu

**State:** Done
**Current Step:** Completed
**Phase:** Phase 1
**Source ID:** 1A.3

### Description
Đề xuất từ mục 1A.3 trong tài liệu nguồn. Các claim lỗi và số liệu cần được đối chiếu với hiện trạng trước khi sửa; đây chưa phải kết quả xác minh hoặc quyết định thiết kế đã được duyệt.

### Scope
- src-tauri/src/repositories/documents.rs
- src-tauri/src/ipc/commands/documents.rs
- contracts/
- src/features/editor/
- src/stores/editor.ts

### Related
- [Kế hoạch duyệt, gates và ràng buộc chung](../plans/collectives-fix-rebuild-review.md)
- [Bản lưu tài liệu nguồn](../plans/collectives-fix-rebuild-source-2026-10-18.md) → 1A.3

### Dependencies
Gate P0; [TASK-016](./TASK-016.md)

### Requirements
- [x] Precondition bắt buộc: thay `Option<String>` bằng enum `Version(token)`, `CreateNew`, `Overwrite{observedDiskToken}`. Không còn đường ghi mù bằng cách bỏ trống tham số.

### Acceptance / Verification plan
Gọi IPC không kèm precondition bị từ chối `precondition_required`. `Overwrite` với token không còn khớp đĩa trả `external_change_conflict`. Contract fixtures cập nhật và `check:contracts` pass.

Các lệnh và phép kiểm tra ở đây dành cho lúc task được duyệt và thực hiện. Ngưỡng nào được nguồn ghi là đề xuất thì cần chốt theo baseline. Nếu claim đã hết đúng, ghi bằng chứng và điều chỉnh task trước khi sửa.

### Steps
- [x] Step 1 — Đối chiếu mục 1A.3 với hiện trạng; kiểm tra phụ thuộc → verify: ghi file/log/fixture hoặc quyết định còn thiếu.
- [x] Step 2 — Thực hiện phạm vi đã được duyệt → verify: đạt Requirements và các ràng buộc chung.
- [x] Step 3 — Nghiệm thu và cập nhật ledger → verify: đáp ứng Acceptance bằng bằng chứng thực chạy hoặc xác nhận được ghi rõ.

### Handoff
- Branch: main; implementation complete.
- Next action: TASK-019 receipt warnings.
- Blockers: none.

### Verification
Windows Rust 1.99.0: cargo check --locked --all-targets passed. Two Rust precondition regressions passed (omitted intent, exclusive create, stale Version/Overwrite, current overwrite, empty token). Frontend save queue 21/21 passed. Typecheck and check:contracts passed; generated fixtures updated. E2E expectation migrated to tagged precondition for the later batch run.

### Log
- 2026-10-18 — Tạo đề xuất Pending từ tài liệu nguồn; chưa triển khai.


- 2026-10-19 — Started explicit typed write preconditions; omission accepted only at IPC boundary to return precondition_required, never a blind write.

- 2026-10-19 — Explicit typed intents implemented across IPC/ports/frontend (DEC-014). Required checks passed; task Done.
