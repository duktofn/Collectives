## TASK-014 — Bật CI bắt buộc và ghi nhận 3 push xanh

**State:** Paused
**Current Step:** Step 3 — Kiểm chứng required check qua PR probe
**Phase:** Phase 0
**Source ID:** 0.5

### Description
Đề xuất từ mục 0.5 trong tài liệu nguồn. Các claim lỗi và số liệu cần được đối chiếu với hiện trạng trước khi sửa; đây chưa phải kết quả xác minh hoặc quyết định thiết kế đã được duyệt.

### Scope
- .github/workflows/ci.yml và main-branch-protection.json
- scripts/ci/verify-policy.mjs; package.json và README
- GitHub repo duktofn/Collectives: branch protection main và PR kiểm chứng không merge
- Task ledger, decision log, CI evidence artifacts

### Related
- [Kế hoạch duyệt, gates và ràng buộc chung](../plans/collectives-fix-rebuild-review.md)
- [Bản lưu tài liệu nguồn](../plans/collectives-fix-rebuild-source-2026-10-18.md) → 0.5

- [Quyết định đã duyệt trong TASK-005](../../decisions.md) → DEC-003

### Dependencies
[TASK-006](./TASK-006.md), [TASK-007](./TASK-007.md), [TASK-008](./TASK-008.md), [TASK-009](./TASK-009.md), [TASK-010](./TASK-010.md), [TASK-011](./TASK-011.md), [TASK-012](./TASK-012.md), [TASK-013](./TASK-013.md), [TASK-015](./TASK-015.md)

### Requirements
- [x] Policy main đã bật các checks từ GitHub Actions app 15368, strict và enforce_admins; TASK-089 thu hẹp còn bốn checks Windows.
- [x] PR có lỗi type được chứng minh blocked qua check bắt buộc.
- [ ] Ba main push thực tế liên tiếp xanh theo acceptance; không tạo push để tích đếm.

### Acceptance / Verification plan
PR kiểm chứng có lỗi type bị chặn merge; 3 push thực tế liên tiếp lên main xanh trên Windows (phạm vi mới tại TASK-089 / DEC-013). Kiểm chứng lỗi chủ động trên nhánh thử nghiệm; không tạo push main chỉ để đủ số lần.

Các lệnh và phép kiểm tra ở đây dành cho lúc task được duyệt và thực hiện. Ngưỡng nào được nguồn ghi là đề xuất thì cần chốt theo baseline. Nếu claim đã hết đúng, ghi bằng chứng và điều chỉnh task trước khi sửa.

### Steps
- [x] Step 1 — Đối chiếu mục 0.5 với hiện trạng; kiểm tra phụ thuộc → verify: ghi file/log/fixture hoặc quyết định còn thiếu.
- [x] Step 2 — Thực hiện phạm vi đã được duyệt → verify: đạt Requirements và các ràng buộc chung.
- [ ] Step 3 — Nghiệm thu và cập nhật ledger → verify: đáp ứng Acceptance bằng bằng chứng thực chạy hoặc xác nhận được ghi rõ.

### Handoff
- Branch: `main`; base commit: `e02d5dc`.
- Next action: TASK-089 chuyển CI và policy sang Windows-only; sau đó theo dõi draft PR #2 và ba main push thực tế.
- Blockers: thiếu ba main push xanh; không tạo push để tích đếm.

### Verification
Negative PR #1 có TS2322, frontend FAILURE, merge BLOCKED; đã đóng không merge. Local Windows frontend: 287 unit tests, typecheck/lint/build/contracts pass; browser 127/127. Policy sáu checks đã read-back; phạm vi Windows-only thay thế tại TASK-089. Chưa có ba main push xanh.

### Log
- 2026-10-18 — Tạo đề xuất Pending từ tài liệu nguồn; chưa triển khai.

- 2026-10-18 — TASK-005 đã chốt phạm vi (DEC-003); cập nhật kế hoạch nghiệm thu, task vẫn Pending và chưa triển khai.
- 2026-10-19 — Bắt đầu sau TASK-015/810ab86; các task 006–013/015 đã Done theo Windows. GitHub credential helper cung cấp quyền admin, main chưa protected. Tất cả 5 main CI run gần nhất fail; không suy ra trạng thái GitHub từ kết quả local.
- 2026-10-19 — Đã version policy 6 status checks từ GitHub Actions app 15368; GitHub PUT thành công và read-back xác nhận strict=true, enforce_admins=true, đủ 6 checks. Snapshot artifacts/task014/protection-before.json và protection-after.json. Đã giữ main chưa merge/push; chuẩn bị PR riêng để kiểm chứng CI type error bị chặn.
- 2026-10-19 — Local typecheck, 287 unit tests, production build và contracts pass; phát hiện/sửa import URL trong script policy để lint pass. Đang rerun canonical frontend gate sạch và toàn bộ E2E trước khi đẩy nhánh kiểm chứng.
- 2026-10-19 — Commit phần policy/CI đã kiểm chứng trước khi chuyển xử lý blocker TASK-088. Main E2E 122/122 pass, Phase 6 4/5; Task014 vẫn Paused cho PR proof và lịch sử CI thực. Không merge/push main.
- 2026-10-19 — Resume sau TASK-088/e02d5dc: Phase 6 5/5, main E2E 122/122, tổng browser Windows 127/127. Chuẩn bị đẩy nhánh codex/phase0-required-ci và PR probe riêng; main giữ nguyên.
- 2026-10-19 — Đã đẩy nhánh codex/phase0-required-ci qua pre-push checks. Tạo negative PR https://github.com/duktofn/Collectives/pull/1 (không draft, BLOCKED khi checks chạy) và draft review PR https://github.com/duktofn/Collectives/pull/2. CI run 39196145598 đang kiểm chứng file type error trong probe branch riêng; source review không chứa fixture lỗi.

- 2026-10-19 — Negative PR #1 ghi nhận TS2322, frontend FAILURE và merge BLOCKED; đã đóng không merge và xóa nhánh probe. Evidence: artifacts/task014/probe-pr-proof.json, probe-frontend.log, probe-closed.json. Browser Windows 127/127 pass sau TASK-088. Tạm dừng để chuyển Windows-only theo yêu cầu mới; ba main push xanh vẫn chưa có.

- 2026-10-19 — TASK-089 cập nhật acceptance nền tảng sang chỉ Windows theo yêu cầu; giữ nguyên tiêu chí ba main push thực tế.
