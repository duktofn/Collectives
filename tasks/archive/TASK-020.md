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
- Branch: main; source and focused regression changes committed locally.
- Next action: none for this task; current requested batch complete.
- Blockers: none within Windows scope.

### Verification
Windows frontend save suite (23 tests) passes, including warning receipt with dirty=false, error/conflict=null, visible notice data, no requeued save and correct next-write token. Typecheck, lint and build pass.

### Log
- 2026-10-18 — Tạo đề xuất Pending từ tài liệu nguồn; chưa triển khai.


- 2026-10-19 — Started warning notice integration after TASK-019 Windows regression passed.

- 2026-10-19 — Windows typecheck and 22 save-state tests pass. Warning receipt clears dirty state, preserves token, leaves error/conflict null, shows dismissible status, does not enqueue duplicate save, and next write uses committed token.

- 2026-10-19 — Final Windows verification recorded; source tree passed typecheck/lint/contracts/build, 291 frontend unit tests, 28 related browser tests and the full Rust all-target test run. No remote push or CI configuration change.
