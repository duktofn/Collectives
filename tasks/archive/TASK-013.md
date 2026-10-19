## TASK-013 — Thêm hook pre-push kiểm tra type và lint

**State:** Done
**Current Step:** Step 3 — Complete trên Windows
**Phase:** Phase 0
**Source ID:** 0.5

### Description
Đã thêm native pre-push hook chạy typecheck và zero-warning lint, installer local/idempotent, lifecycle prepare và hướng dẫn cài lại. Hook không thêm dependency hoặc ghi đè cấu hình hooks riêng.

### Scope
- .githooks/pre-push; .gitattributes
- scripts/git/install-hooks.mjs, pre-push.mjs và verify-pre-push.mjs
- package.json, package-lock.json nếu metadata đổi, README.md và tài liệu hook
- Git local core.hooksPath; task/decision ledger (CI/branch protection thuộc TASK-014)

### Related
- [Kế hoạch duyệt, gates và ràng buộc chung](../plans/collectives-fix-rebuild-review.md)
- [Bản lưu tài liệu nguồn](../plans/collectives-fix-rebuild-source-2026-10-18.md) → 0.5

### Dependencies
[TASK-006](./TASK-006.md)

### Requirements
- [x] Hook pre-push chạy typecheck và lint theo cấu hình repository; hướng dẫn cài hook tái lập.

### Acceptance / Verification plan
Hook trả mã lỗi khi fixture type/lint sai và cho qua khi đúng; ghi lại cách hook được kích hoạt.

Các lệnh và phép kiểm tra ở đây dành cho lúc task được duyệt và thực hiện. Ngưỡng nào được nguồn ghi là đề xuất thì cần chốt theo baseline. Nếu claim đã hết đúng, ghi bằng chứng và điều chỉnh task trước khi sửa.

### Steps
- [x] Step 1 — Đối chiếu mục 0.5 với hiện trạng; kiểm tra phụ thuộc → verify: ghi file/log/fixture hoặc quyết định còn thiếu.
- [x] Step 2 — Thực hiện phạm vi đã được duyệt → verify: đạt Requirements và các ràng buộc chung.
- [x] Step 3 — Nghiệm thu và cập nhật ledger → verify: đáp ứng Acceptance bằng bằng chứng thực chạy hoặc xác nhận được ghi rõ.

### Handoff
- Branch: `main`
- Base commit: `cbb92b0`
- Uncommitted files: bộ tài liệu Pending; chưa có thay đổi triển khai cho task này.
- Next action: none cho TASK-013; triển khai TASK-015 trước TASK-014 theo phụ thuộc.
- Blockers: none; core.hooksPath và default custom hooks đều chưa có.

### Verification
Windows: npm run test:hooks pass bằng Git push thật tới bare repo local: TS2322 chặn push, warning no-unused-vars chặn push, code sạch push thành công. Fresh clone cài lại hook có executable mode/LF; cấu hình hooks riêng được giữ nguyên; source archive không Git được skip. Bằng chứng artifacts/task013/hook-verification.json. npm run hooks:install và node scripts/git/pre-push.mjs thực chạy typecheck/lint của repo exit 0; changed-script ESLint và diff check pass. core.hooksPath local=.githooks. Không đổi package-lock/dependency versions. Native Linux/macOS theo TASK-086.

### Log
- 2026-10-18 — Tạo đề xuất Pending từ tài liệu nguồn; chưa triển khai.
- 2026-10-19 — Bắt đầu TASK-013 sau commit cbb92b0; chọn native Git hooks có installer, không thêm dependency. Kiểm chứng bằng Git push tới bare repo local, TypeScript/ESLint thật; tránh dùng remote production để thử lỗi.
- 2026-10-19 — Đã hoàn tất cài đặt và kiểm chứng push âm/dương, fresh clone, bảo toàn custom hooks/source archive. Typecheck/lint repo và script lint pass; Done, commit riêng hook/tooling/docs/task. DEC-011 ghi lựa chọn; hash trong task.md.
