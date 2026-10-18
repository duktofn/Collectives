## TASK-006 — Sửa lỗi TypeScript và ESLint trong test frontend

**State:** Done
**Current Step:** Step 3 — Complete
**Phase:** Phase 0
**Source ID:** 0.1

### Description
Đã tái hiện và sửa đúng hai lỗi test frontend ở mục 0.1: binding getByRole không dùng và option exact không được ByRoleOptions hỗ trợ. Giữ nguyên các assertion và hành vi sản phẩm.

### Scope
- src/App.phase4.test.tsx
- src/components/theme/ThemePanel.test.tsx
- Task ledger, kế hoạch và ghi chú baseline trong codebase.md

### Related
- [Kế hoạch duyệt, gates và ràng buộc chung](../plans/collectives-fix-rebuild-review.md)
- [Bản lưu tài liệu nguồn](../plans/collectives-fix-rebuild-source-2026-10-18.md) → 0.1

### Dependencies
Không có phụ thuộc kỹ thuật; người dùng đã yêu cầu tiếp tục TASK-006.

### Requirements
- [x] Sửa 2 lỗi TypeScript: `App.phase4.test.tsx:36` (biến `getByRole` không dùng, cũng là warning ESLint duy nhất) và `ThemePanel.test.tsx:157` (option `exact` không tồn tại trong `ByRoleOptions`).

### Acceptance / Verification plan
`npm run typecheck` và `npm run lint` thoát với mã 0 (`--max-warnings 0`).

Các lệnh và phép kiểm tra ở đây dành cho lúc task được duyệt và thực hiện. Ngưỡng nào được nguồn ghi là đề xuất thì cần chốt theo baseline. Nếu claim đã hết đúng, ghi bằng chứng và điều chỉnh task trước khi sửa.

### Steps
- [x] Step 1 — Đối chiếu mục 0.1 với hiện trạng; kiểm tra phụ thuộc → verify: ghi file/log/fixture hoặc quyết định còn thiếu.
- [x] Step 2 — Thực hiện phạm vi đã được duyệt → verify: đạt Requirements và các ràng buộc chung.
- [x] Step 3 — Nghiệm thu và cập nhật ledger → verify: đáp ứng Acceptance bằng bằng chứng thực chạy hoặc xác nhận được ghi rõ.

### Handoff
- Branch: `main`
- Base commit: `110bc56` (mốc phân rã kế hoạch)
- Uncommitted files: src/App.phase4.test.tsx, src/components/theme/ThemePanel.test.tsx, codebase.md, task.md, tasks/archive/TASK-006.md, tasks/plans/collectives-fix-rebuild-review.md; các task kế hoạch từ trước vẫn chưa commit.
- Next action: none cho TASK-006; task kế tiếp TASK-007 vẫn Pending.
- Blockers: none.

### Verification
Trước sửa: npm run typecheck exit 1 với TS6133 tại App.phase4.test.tsx:36 và TS2769 tại ThemePanel.test.tsx:157; npm run lint exit 1 vì đúng một warning getByRole không dùng.

Sau sửa: npm run typecheck exit 0; npm run lint exit 0 (--max-warnings 0); npm run test -- --run src/App.phase4.test.tsx src/components/theme/ThemePanel.test.tsx exit 0, 2 file / 12 test pass. git diff --check pass. Diff source chỉ gồm hai dòng đã nêu; không đổi assertion. Không chạy E2E, Rust hoặc build vì ngoài phạm vi TASK-006; không có thay đổi hành vi người dùng để ghi changelog.

### Log
- 2026-10-18 — Tạo đề xuất Pending từ tài liệu nguồn; chưa triển khai.
- 2026-10-18 — Người dùng yêu cầu continue; bắt đầu TASK-006 trên main/110bc56, chưa có thay đổi source được track. Đã xác nhận hai dòng được báo cáo vẫn còn; đang thu baseline typecheck/lint.

- 2026-10-18 — Step 1 hoàn tất: tái hiện đúng hai lỗi TypeScript và một warning lint. Step 2 bắt đầu: chỉ bỏ binding không dùng và option exact không được ByRoleOptions hỗ trợ.

- 2026-10-18 — Step 2 hoàn tất: bỏ getByRole khỏi destructuring và bỏ exact khỏi query button Typography; giữ nguyên assertions. Bắt đầu typecheck, lint và hai file test liên quan.
- 2026-10-18 — Step 3 hoàn tất: typecheck/lint exit 0, 12/12 test liên quan pass, diff check pass. Cập nhật ghi chú baseline và kế hoạch, archive TASK-006 Done. Chưa commit.
- 2026-10-18 — Người dùng yêu cầu commit theo task; chuẩn bị commit riêng hai dòng sửa test và entry TASK-006. Hash commit được lưu tại task.md → Commit log.
