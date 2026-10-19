## TASK-020 — Frontend công nhận save thành công dù receipt có warning

**State:** Done
**Current Step:** Completed
**Phase:** Phase 1
**Source ID:** 1A.5

### Description
Đề xuất từ mục 1A.5 trong tài liệu nguồn. Các claim lỗi và số liệu cần được đối chiếu với hiện trạng trước khi sửa; đây chưa phải kết quả xác minh hoặc quyết định thiết kế đã được duyệt.

### Scope
- src/stores/editor.ts
- src/features/editor/
- UI thông báo save

### Related
- [Kế hoạch duyệt, gates và ràng buộc chung](../plans/collectives-fix-rebuild-review.md)
- [Bản lưu tài liệu nguồn](../plans/collectives-fix-rebuild-source-2026-10-18.md) → 1A.5

### Dependencies
Gate P0; [TASK-019](./TASK-019.md)

### Requirements
- [x] Frontend coi receipt có warning là đã lưu: `isDirty` về false, hiện thông báo không chặn, không enqueue lại.

### Acceptance / Verification plan
Vitest: mock `writeFile` trả `{versionToken, warnings}` cho kết quả `isDirty=false`, `error=null`, `conflictKind=null`, có notice.

Các lệnh và phép kiểm tra ở đây dành cho lúc task được duyệt và thực hiện. Ngưỡng nào được nguồn ghi là đề xuất thì cần chốt theo baseline. Nếu claim đã hết đúng, ghi bằng chứng và điều chỉnh task trước khi sửa.

### Steps
- [x] Step 1 — Đối chiếu mục 1A.5 với hiện trạng; kiểm tra phụ thuộc → verify: ghi file/log/fixture hoặc quyết định còn thiếu.
- [x] Step 2 — Thực hiện phạm vi đã được duyệt → verify: đạt Requirements và các ràng buộc chung.
- [x] Step 3 — Nghiệm thu và cập nhật ledger → verify: đáp ứng Acceptance bằng bằng chứng thực chạy hoặc xác nhận được ghi rõ.

### Handoff
- Branch: `main`
- Base commit: `110bc56` (mốc phân rã kế hoạch)
- Uncommitted files: bộ tài liệu Pending; chưa có thay đổi triển khai cho task này.
- Next action: Người dùng duyệt TASK-020; khi bắt đầu, kiểm tra lại git và Dependencies, rồi làm Step 1.
- Blockers: chờ duyệt và các phụ thuộc chưa hoàn tất.

### Verification
Chưa triển khai; chưa chạy test sản phẩm. Các tiêu chí nghiệm thu chưa được xác nhận đạt.

### Log
- 2026-10-18 — Tạo đề xuất Pending từ tài liệu nguồn; chưa triển khai.


- 2026-10-19 — Started warning notice integration after TASK-019 Windows regression passed.

- 2026-10-19 — Windows typecheck and 22 save-state tests pass. Warning receipt clears dirty state, preserves token, leaves error/conflict null, shows dismissible status, does not enqueue duplicate save, and next write uses committed token.
