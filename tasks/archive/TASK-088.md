## TASK-088 — Sửa kiểm tra Phase 6 cho activity status tùy chọn

**State:** Done
**Current Step:** Step 3 — Complete trên Windows

### Description
Blocker phát hiện trong nghiệm thu TASK-014: Phase 6 luôn chờ status bar dù production shell đã không truyền activityStatus. Giữ contract a11y cho slot tùy chọn, sửa kỳ vọng stale thay vì thay UI.

### Scope
- e2e/phase6.accessibility.spec.ts
- Unit/Phase 6 checks liên quan; task ledger
- Không đổi runtime AppShell hoặc đưa status bar cũ trở lại

### Requirements
- [x] Có bằng chứng đỏ trước sửa và xác nhận slot activityStatus là optional.
- [x] Kiểm tra at-most-one activity status và aria-live=off khi được render; không timeout khi slot vắng.
- [x] Toàn bộ Phase 6 và shell unit pass trên Windows; commit riêng trước khi resume TASK-014.

### Steps
- [x] Step 1 — Đối chiếu hiện trạng → verify: e2e-phase6.json 4/5, AppShell optional slot.
- [x] Step 2 — Sửa assertion → verify: giữ live-region constraint, không thêm sleep/skip.
- [x] Step 3 — Nghiệm thu/commit → verify: Phase 6 và shell unit pass.

### Handoff
- Branch: main
- Base commit: d41f5d5
- Uncommitted files: chưa sửa source cho task này.
- Next action: none cho TASK-088; resume TASK-014 để kiểm chứng GitHub.
- Blockers: none; được tách để xử lý blocker CI thuộc mục tiêu TASK-014 đã duyệt.

### Verification
Trước sửa: artifacts/task014/e2e-phase6.json ghi 4 pass, 1 timeout ở activity-status absent. Sau sửa: artifacts/task088/after.json ghi 5/5 Phase 6 pass; appShell unit 2/2 pass; changed-file ESLint/diff check pass. Main visible vẫn bắt buộc; optional status tối đa một và aria-live=off nếu được render. Không sửa runtime/ARIA contract, không skip hoặc kéo timeout.

### Log
- 2026-10-19 — Tạo task riêng cho defect test được phát hiện khi kiểm tra CI của TASK-014; không gộp thay đổi vào commit policy.
- 2026-10-19 — AppShell.activityStatus?: JSX.Element và Show condition xác nhận optional. Snapshot các status hiện hữu, yêu cầu tối đa một và aria-live=off; thêm main visible bắt buộc để tránh test pass trên trang rỗng. Shell unit 2/2 và lượt Phase 6 đầu 5/5 pass; chạy lại với guard main visible.
- 2026-10-19 — Done: 5/5 Phase 6, 2/2 shell unit pass; commit riêng test/task trước resume policy CI.
