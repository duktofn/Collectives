## TASK-012 — Sửa vị trí caret khi click chữ in đậm

**State:** Done
**Current Step:** Step 3 — Complete trên Windows
**Phase:** Phase 0
**Source ID:** 0.4

### Description
Baseline tái hiện một test kỳ vọng pixel trước khi Markdown delimiters hiện ra, dù source offset đã đúng. Cập nhật riêng ca bold để đo glyph sau reveal theo DEC-001; giữ tolerance 3px, source-offset và nội dung chèn.

### Scope
- e2e/
- src/App.tsx
- src/lib/cm-extensions/
- scripts/phase0/verify-quality.mjs

### Related
- [Kế hoạch duyệt, gates và ràng buộc chung](../plans/collectives-fix-rebuild-review.md)
- [Bản lưu tài liệu nguồn](../plans/collectives-fix-rebuild-source-2026-10-18.md) → 0.4

### Dependencies
Không có phụ thuộc kỹ thuật; chờ duyệt trước khi triển khai.

### Requirements
- [x] Tái hiện lệch caret khi click chữ in đậm; phân loại lỗi sản phẩm hay test và sửa đúng nguyên nhân.

### Acceptance / Verification plan
Test click chữ in đậm đặt caret đúng vị trí và pass; giữ bằng chứng đỏ trước fix nếu lỗi sản phẩm; không dùng .skip.

Các lệnh và phép kiểm tra ở đây dành cho lúc task được duyệt và thực hiện. Ngưỡng nào được nguồn ghi là đề xuất thì cần chốt theo baseline. Nếu claim đã hết đúng, ghi bằng chứng và điều chỉnh task trước khi sửa.

### Steps
- [x] Step 1 — Đối chiếu mục 0.4 với hiện trạng; kiểm tra phụ thuộc → verify: ghi file/log/fixture hoặc quyết định còn thiếu.
- [x] Step 2 — Thực hiện phạm vi đã được duyệt → verify: đạt Requirements và các ràng buộc chung.
- [x] Step 3 — Nghiệm thu và cập nhật ledger → verify: đáp ứng Acceptance bằng bằng chứng thực chạy hoặc xác nhận được ghi rõ.

### Handoff
- Branch: `main`
- Base commit: `825fd14`
- Uncommitted files: bộ tài liệu Pending; chưa có thay đổi triển khai cho task này.
- Next action: none cho TASK-012; triển khai TASK-013 sau commit.
- Blockers: none.

### Verification
Windows: baseline 15/16 pass, bold fail x-distance=13.506px nhưng head đúng. Sau sửa, write-cursor và editor-inline-formatting 16/16 pass (artifacts/task012/after.json), 0 unexpected/skipped/flaky. Changed-file ESLint exit 0 và diff check pass. Không đổi runtime editor hoặc các assertion của heading/plain/wrapped prose; thêm assertion bold hiện **...** và so caret với glyph sau reveal. Không cần changelog hành vi sản phẩm. Linux/macOS theo TASK-086.

### Log
- 2026-10-18 — Tạo đề xuất Pending từ tài liệu nguồn; chưa triển khai.
- 2026-10-19 — Bắt đầu TASK-012 sau commit TASK-011 (825fd14); tiếp tục batch 5 task đã được người dùng duyệt.
- 2026-10-19 — Baseline 15/16 pass: source offset đúng, riêng bold fail x-distance=13.506px vì ** được reveal theo DEC-001 (cho phép inline geometry đổi). Regression inline-formatting click/insert đã pass. Giữ source offset, insertion và tolerance 3px; so caret với glyph sau reveal, thêm assertion **bold words** hiển thị.
- 2026-10-19 — Xác nhận report sau sửa 16/16 pass; lint/diff check pass. Done theo DEC-001 và nghiệm thu Windows; commit riêng test và task/follow-up, hash ở task.md.
