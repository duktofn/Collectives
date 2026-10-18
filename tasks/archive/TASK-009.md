## TASK-009 — Sửa tương tác click và caret trong code block

**State:** Done
**Current Step:** Step 3 — Complete trên Windows
**Phase:** Phase 0
**Source ID:** 0.4

### Description
Đã tái hiện hai ca E2E false failure trong nhóm code click khi sidebar đang thu gọn. Phân loại là race đo bố cục trong test, sửa bằng chờ control ổn định và lấy hai khung trong cùng frame; giữ nguyên assertions bố cục, caret, drag, keyboard và nội dung.

### Scope
- e2e/code-click-drift.spec.ts
- Kiểm chứng: e2e/editor-code-block-interaction.spec.ts và e2e/editor-layout-interaction.spec.ts
- Task ledger, kế hoạch và follow-up Linux/macOS tại TASK-086

### Related
- [Kế hoạch duyệt, gates và ràng buộc chung](../plans/collectives-fix-rebuild-review.md)
- [Bản lưu tài liệu nguồn](../plans/collectives-fix-rebuild-source-2026-10-18.md) → 0.4

### Dependencies
TASK-087 đã Done và commit 49426b7; người dùng đã yêu cầu tiếp tục TASK-009.

### Requirements
- [x] Tái hiện lỗi E2E click trong code block được báo cáo; phân loại lỗi sản phẩm hay test và sửa đúng nguyên nhân.

### Acceptance / Verification plan
Test click/caret trong code block pass; nếu lỗi sản phẩm, lưu bằng chứng test tái hiện đỏ trước fix; không dùng .skip.

Các lệnh và phép kiểm tra ở đây dành cho lúc task được duyệt và thực hiện. Ngưỡng nào được nguồn ghi là đề xuất thì cần chốt theo baseline. Nếu claim đã hết đúng, ghi bằng chứng và điều chỉnh task trước khi sửa.

### Steps
- [x] Step 1 — Đối chiếu mục 0.4 với hiện trạng; kiểm tra phụ thuộc → verify: ghi file/log/fixture hoặc quyết định còn thiếu.
- [x] Step 2 — Thực hiện phạm vi đã được duyệt → verify: đạt Requirements và các ràng buộc chung.
- [x] Step 3 — Nghiệm thu và cập nhật ledger → verify: đáp ứng Acceptance bằng bằng chứng thực chạy hoặc xác nhận được ghi rõ.

### Handoff
- Branch: `main`
- Base commit: `49426b7`
- Uncommitted files: e2e/code-click-drift.spec.ts, entry TASK-009 và cập nhật follow-up TASK-086 được chọn commit riêng; các tài liệu Pending khác giữ ngoài commit.
- Next action: none cho TASK-009; TASK-010 tiếp theo vẫn Pending. Native Linux/macOS theo TASK-086.
- Blockers: none; kiểm chứng nền tảng khác thuộc TASK-086.

### Verification
Windows / Chromium:
- Trước sửa: 22 pass, 2 fail trong 24 test ([baseline.json](../../artifacts/task009/baseline.json)). Cả hai fail trước assertions caret ở phép đo header/button.
- Diagnostic lặp lại 2 fail; snapshot cùng frame cho vị trí button đúng trong header, position=static ([geometry-measurements-before.json](../../artifacts/task009/geometry-measurements-before.json)). Xác định race của test, không tái hiện bug caret sản phẩm.
- Sau sửa: 24/24 pass, 0 fail/skip/flaky ([after.json](../../artifacts/task009/after.json)).
- Lặp ba lần mỗi ca collapsed=true: 6/6 pass, 0 fail/skip/flaky ([repeated.json](../../artifacts/task009/repeated.json)).
- npx eslint e2e/code-click-drift.spec.ts --max-warnings 0 và git diff --check pass.
- Giữ toàn bộ assertions caret, doc, layout và style; không sửa code runtime editor, không dùng sleep cố định hoặc .skip. Đây là sửa test nên không thêm changelog hành vi sản phẩm. Native Linux/macOS theo TASK-086.

### Log
- 2026-10-18 — Tạo đề xuất Pending từ tài liệu nguồn; chưa triển khai.
- 2026-10-18 — Bắt đầu sau khi commit TASK-087. Source/frontend không có thay đổi chưa commit; chạy ba spec liên quan code block/caret theo nghiệm thu Windows trước.
- 2026-10-18 — Baseline 24 test: 22 pass, 2 fail khi collapsed=true do đo header/button ở hai animation frame khác nhau, trước khi chạy assertions caret. Diagnostic lặp lại 2 fail: geometry cùng frame cho buttonX=headerX+13 và position=static ở cả font scale 1/1.3, trong khi hai boundingBox tách biệt cho kết quả mâu thuẫn. Lưu baseline.json, geometry-before.json và geometry-measurements-before.json tại artifacts/task009/. Phân loại: race của test, chưa có lỗi caret sản phẩm tái hiện.
- 2026-10-18 — Step 2 hoàn tất: chờ control ổn định bằng trial click, đo header/button/style trong cùng evaluate; giữ ba assertion bố cục và toàn bộ assertion caret/document. Step 3: 24/24 test pass, changed-file ESLint và diff check pass; chạy lặp 3 lần cho mỗi ca collapsed=true để kiểm chứng race đã hết.
- 2026-10-18 — Nghiệm thu 24/24 và 6/6 lượt lặp, 0 skipped/flaky; lint/diff check pass. TASK-009 Done, commit riêng test và task/follow-up; hash ghi ở task.md → Commit log.
