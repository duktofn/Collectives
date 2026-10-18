## TASK-010 — Sửa lỗi E2E context menu

**State:** Done
**Current Step:** Step 3 — Complete trên Windows
**Phase:** Phase 0
**Source ID:** 0.4

### Description
Đã đối chiếu báo cáo lỗi context menu với revision hiện tại. Toàn bộ kiểm tra liên quan trên Windows pass ngay ở baseline và khi lặp lại; chưa tái hiện lỗi, nên không sửa logic đang hoạt động hoặc thay đổi assertions.

### Scope
- Kiểm chứng: e2e/editor-floating-controls.spec.ts
- Kiểm chứng: src/components/common/ContextMenu.a11y.test.tsx; đối chiếu ContextMenu.tsx và EditorSurface.tsx
- Task ledger, kế hoạch và follow-up Linux/macOS tại TASK-086; không đổi source/test/assertions

### Related
- [Kế hoạch duyệt, gates và ràng buộc chung](../plans/collectives-fix-rebuild-review.md)
- [Bản lưu tài liệu nguồn](../plans/collectives-fix-rebuild-source-2026-10-18.md) → 0.4

### Dependencies
Người dùng yêu cầu bắt đầu TASK-010; nghiệm thu Windows trước, Linux/macOS theo TASK-086.

### Requirements
- [x] Đối chiếu báo cáo với hiện trạng và kiểm chứng các hành vi context menu; xác nhận chưa tái hiện trên Windows.
- [x] 6 E2E, 3 unit và 9 lượt lặp các ca chính pass; không skip/flaky và không thay assertions để làm test xanh.
- [x] Kiểm chứng Linux/macOS được chuyển TASK-086 theo DEC-008.

### Acceptance / Verification plan
Các test context menu liên quan pass; có bằng chứng đỏ trước fix nếu lỗi sản phẩm; không dùng .skip.

Các lệnh và phép kiểm tra ở đây dành cho lúc task được duyệt và thực hiện. Ngưỡng nào được nguồn ghi là đề xuất thì cần chốt theo baseline. Nếu claim đã hết đúng, ghi bằng chứng và điều chỉnh task trước khi sửa.

### Steps
- [x] Step 1 — Đối chiếu mục 0.4 với hiện trạng; kiểm tra phụ thuộc → verify: ghi file/log/fixture hoặc quyết định còn thiếu.
- [x] Step 2 — Xác minh bản hiện tại bằng các ca lặp lại → verify: Windows đã đạt, không có failure đủ bằng chứng để sửa source.
- [x] Step 3 — Nghiệm thu và cập nhật ledger → verify: đáp ứng Acceptance bằng bằng chứng thực chạy hoặc xác nhận được ghi rõ.

### Handoff
- Branch: `main`
- Base commit: `439250d`
- Uncommitted files: entry TASK-010 và follow-up TASK-086 được chọn commit riêng; không có thay đổi source/test sản phẩm.
- Next action: none cho TASK-010; TASK-011 tiếp theo vẫn Pending. TASK-086 giữ kiểm chứng Linux/macOS.
- Blockers: none.

### Verification
Windows / Chromium tại source revision 439250d:
- npx playwright test e2e/editor-floating-controls.spec.ts: 6/6 pass, 0 unexpected/skipped/flaky ([baseline.json](../../artifacts/task010/baseline.json)).
- npm run test -- --run src/components/common/ContextMenu.a11y.test.tsx: 3/3 pass, exit 0.
- Ba ca pointer/keyboard submenu, chart/table/sidebar actions và readonly/clipboard failure chạy lặp 3 lần: 9/9 pass, 0 unexpected/skipped/flaky ([repeated.json](../../artifacts/task010/repeated.json)).
- Kiểm chứng copy/cut/paste, clipboard bị từ chối không mất nội dung, keyboard navigation, focus restoration và activation một lần.
- git diff --name-only -- src e2e src-tauri rỗng. Không đổi source, assertions, test selection trong file hoặc thêm .skip; không thêm changelog vì không triển khai thay đổi hành vi.

Kết luận: báo cáo cũ chưa tái hiện trên Windows hiện tại; không có bằng chứng lỗi sản phẩm hay lỗi test đang tồn tại để sửa. Done theo nghiệm thu Windows tại DEC-008; native Linux/macOS chưa được kiểm tra và theo TASK-086.

### Log
- 2026-10-18 — Tạo đề xuất Pending từ tài liệu nguồn; chưa triển khai.
- 2026-10-18 — Bắt đầu theo yêu cầu người dùng; branch main/439250d, tracked source sạch. Thu baseline E2E context menu và unit trước khi sửa.
- 2026-10-18 — Baseline Windows: cả 6 test editor-floating-controls và 3 unit ContextMenu.a11y pass. Lỗi context menu được báo cáo chưa tái hiện trên revision hiện tại; baseline.json lưu artifacts/task010/. Chạy lặp ba lần các ca pointer/keyboard submenu, chart/table actions và clipboard/read-only để kiểm tra tính ổn định trước khi kết luận.
- 2026-10-18 — Các ca lặp pass 9/9; toàn bộ baseline E2E 6/6 và unit 3/3 pass. Đóng TASK-010 Done trên Windows bằng kiểm chứng hiện trạng, không tuyên bố đã sửa một lỗi chưa tái hiện. Commit riêng tài liệu nghiệm thu/follow-up; hash ở task.md → Commit log.
