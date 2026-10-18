## TASK-011 — Sửa Quick Open chọn sai tài liệu

**State:** Done
**Current Step:** Step 3 — Complete trên Windows
**Phase:** Phase 0
**Source ID:** 0.4

### Description
Đã tái hiện và sửa Quick Open quay về note trước do selection effect và callback cùng mở file. Callback chờ hàng đợi selection và kiểm tra intent trước fallback; regression kiểm tra file, nội dung và một IPC read.

### Scope
- e2e/workspace-ux.spec.ts và hồi quy Quick Open liên quan
- src/App.tsx; src/components/search/QuickOpenDialog.tsx và unit tests
- Task ledger, plan, changelog nếu sửa hành vi sản phẩm

### Related
- [Kế hoạch duyệt, gates và ràng buộc chung](../plans/collectives-fix-rebuild-review.md)
- [Bản lưu tài liệu nguồn](../plans/collectives-fix-rebuild-source-2026-10-18.md) → 0.4

### Dependencies
Không có phụ thuộc kỹ thuật; chờ duyệt trước khi triển khai.

### Requirements
- [x] Tái hiện việc Quick Open mở sai tài liệu; kiểm tra hàng đợi chuyển selection trong App.tsx và sửa bug chức năng.

### Acceptance / Verification plan
Test hồi quy chỉ rõ tài liệu được chọn và được mở; đỏ trước fix, xanh sau fix; không dùng .skip. Luồng A/B/C tổng quát tiếp tục ở 5.8.

Các lệnh và phép kiểm tra ở đây dành cho lúc task được duyệt và thực hiện. Ngưỡng nào được nguồn ghi là đề xuất thì cần chốt theo baseline. Nếu claim đã hết đúng, ghi bằng chứng và điều chỉnh task trước khi sửa.

### Steps
- [x] Step 1 — Đối chiếu mục 0.4 với hiện trạng; kiểm tra phụ thuộc → verify: ghi file/log/fixture hoặc quyết định còn thiếu.
- [x] Step 2 — Thực hiện phạm vi đã được duyệt → verify: đạt Requirements và các ràng buộc chung.
- [x] Step 3 — Nghiệm thu và cập nhật ledger → verify: đáp ứng Acceptance bằng bằng chứng thực chạy hoặc xác nhận được ghi rõ.

### Handoff
- Branch: `main`
- Base commit: `edff024`
- Uncommitted files: bộ tài liệu Pending; chưa có thay đổi triển khai cho task này.
- Next action: none cho TASK-011; triển khai TASK-012 sau commit.
- Blockers: none; nghiệm thu Windows trước theo DEC-008.

### Verification
Windows: regression cũ fail trước sửa (chọn Weekly review, vẫn Product direction). Regression mới trước sửa fail với read paths [Third.md, Third.md, First.md]. Sau sửa toàn bộ workspace-ux 11/11 pass, regression chỉ ghi một read đúng file và nội dung đúng; unit QuickOpenDialog 1/1 pass. npm run typecheck và npm run lint exit 0. Bằng chứng: artifacts/task011/baseline.json, contract-before.json, after.json. Không skip hoặc đổi kỳ vọng cũ. Changelog Unreleased ghi bug fix tiếng Anh; DEC-010 ghi chiến lược điều phối.

### Log
- 2026-10-18 — Tạo đề xuất Pending từ tài liệu nguồn; chưa triển khai.
- 2026-10-18 — Người dùng phê duyệt triển khai TASK-011–TASK-015; bắt đầu TASK-011 trên main/edff024, tracked source sạch.
- 2026-10-18 — Baseline E2E Quick Open fail: chọn Weekly review nhưng editor vẫn Product direction; unit QuickOpenDialog 1/1 pass. App vừa selectEntry (kích hoạt selectionTransition), vừa gọi openFile trực tiếp; các open request cạnh tranh và nhánh restoreDisplayedSelection có thể khôi phục file cũ. Thêm kiểm chứng path/content/IPC trước khi sửa để xác nhận đúng nguyên nhân.
- 2026-10-18 — Regression mới trước fix ghi đúng ba read_file: Third.md, Third.md, First.md; chứng minh duplicate open và rollback selection. Sửa openQuickCandidate chờ selectionTransition, giữ fallback sau khi kiểm tra selection/collection còn đúng intent; không rebuild toàn bộ selection queue thuộc TASK-067.
- 2026-10-18 — Step 3 hoàn tất: 11 E2E, 1 unit, typecheck/lint pass; ghi changelog và DEC-010, Done. Commit riêng App, regression và task entry; hash trong task.md.
