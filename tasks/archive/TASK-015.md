## TASK-015 — Cho matrix backend trả kết quả độc lập trên từng OS

**State:** Done
**Current Step:** Step 3 — Complete theo kiểm tra cấu hình Windows
**Phase:** Phase 0
**Source ID:** 0.6

### Description
Đề xuất từ mục 0.6 trong tài liệu nguồn. Các claim lỗi và số liệu cần được đối chiếu với hiện trạng trước khi sửa; đây chưa phải kết quả xác minh hoặc quyết định thiết kế đã được duyệt.

### Scope
- .github/workflows/ci.yml

### Related
- [Kế hoạch duyệt, gates và ràng buộc chung](../plans/collectives-fix-rebuild-review.md)
- [Bản lưu tài liệu nguồn](../plans/collectives-fix-rebuild-source-2026-10-18.md) → 0.6

- [Quyết định đã duyệt trong TASK-005](../../decisions.md) → DEC-003

### Dependencies
Không có phụ thuộc kỹ thuật; chờ duyệt trước khi triển khai.

### Requirements
- [x] Đặt `fail-fast: false` cho matrix backend cho đủ ubuntu-latest, windows-latest, macos-latest để một OS lỗi không hủy hai OS còn lại.

- [x] Matrix backend bao gồm Windows, Linux và macOS theo DEC-003.

### Acceptance / Verification plan
Nghiệm thu Windows trước theo DEC-008: parse YAML và xác nhận fail-fast=false, matrix đủ ba OS, canonical gates/setup đúng OS được giữ. Thử lỗi Linux trên runner native để chứng minh Windows/macOS không bị cancel chuyển TASK-086.

Các lệnh và phép kiểm tra ở đây dành cho lúc task được duyệt và thực hiện. Ngưỡng nào được nguồn ghi là đề xuất thì cần chốt theo baseline. Nếu claim đã hết đúng, ghi bằng chứng và điều chỉnh task trước khi sửa.

### Steps
- [x] Step 1 — Đối chiếu mục 0.6 với hiện trạng; kiểm tra phụ thuộc → verify: ghi file/log/fixture hoặc quyết định còn thiếu.
- [x] Step 2 — Thực hiện phạm vi đã được duyệt → verify: đạt Requirements và các ràng buộc chung.
- [x] Step 3 — Nghiệm thu và cập nhật ledger → verify: đáp ứng Acceptance bằng bằng chứng thực chạy hoặc xác nhận được ghi rõ.

### Handoff
- Branch: `main`
- Base commit: `18ff19c`
- Uncommitted files: bộ tài liệu Pending; chưa có thay đổi triển khai cho task này.
- Next action: none cho TASK-015; TASK-014 bật CI bắt buộc; runtime matrix validation thuộc TASK-086.
- Blockers: none trong phạm vi Windows; CI native theo TASK-086.

### Verification
Windows config check pass bằng js-yaml/assert: YAML hợp lệ, fail-fast=false, matrix ubuntu/windows/macos, runs-on sử dụng matrix.os, Linux dependencies chỉ cài trên ubuntu, canonical backend command và Rust 1.97.0 được giữ. git diff --check pass. artifacts/task015/config-check.json ghi bằng chứng. Chưa chạy/cố ý làm fail runner Linux/macOS; kiểm chứng runtime đó theo TASK-086, không tuyên bố đã thử native.

### Log
- 2026-10-18 — Tạo đề xuất Pending từ tài liệu nguồn; chưa triển khai.

- 2026-10-18 — TASK-005 đã chốt phạm vi (DEC-003); cập nhật kế hoạch nghiệm thu, task vẫn Pending và chưa triển khai.
- 2026-10-19 — Bắt đầu sau TASK-013/18ff19c vì TASK-014 phụ thuộc task này. Baseline matrix chỉ ubuntu/windows và fail-fast mặc định.
- 2026-10-19 — Cấu hình đã sửa và verify pass trên Windows, native matrix test chuyển TASK-086. Done theo DEC-008, commit riêng workflow/task/follow-up.
