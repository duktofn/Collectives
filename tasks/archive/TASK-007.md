## TASK-007 — Sửa benchmark Rust để compile trên Windows, Linux và macOS

**State:** Paused
**Current Step:** Step 3 — Chờ cargo check trên Linux và macOS với toolchain ghim
**Phase:** Phase 0
**Source ID:** 0.2

### Description
Đề xuất từ mục 0.2 trong tài liệu nguồn. Các claim lỗi và số liệu cần được đối chiếu với hiện trạng trước khi sửa; đây chưa phải kết quả xác minh hoặc quyết định thiết kế đã được duyệt.

### Scope
- src-tauri/src/bin/phase0_bench.rs

### Related
- [Kế hoạch duyệt, gates và ràng buộc chung](../plans/collectives-fix-rebuild-review.md)
- [Bản lưu tài liệu nguồn](../plans/collectives-fix-rebuild-source-2026-10-18.md) → 0.2

- [Quyết định đã duyệt trong TASK-005](../../decisions.md) → DEC-003

### Dependencies
Không có phụ thuộc kỹ thuật để sửa code. CI ba OS sẽ được đối chiếu với matrix ở TASK-015; DEC-003 đã Accepted.

### Requirements
- [ ] `phase0_bench.rs` compile trên mọi OS: bỏ `#[cfg(windows)]` khỏi `use std::process::Command` (là std, dùng được mọi nền tảng); sửa closure ở khối `#[cfg(unix)]` để parse ngay trong closure hoặc `to_owned()` trước khi trả.

- [x] Command được import trên mọi target.
- [x] Parse giá trị RSS trước khi closure sở hữu status kết thúc; probe trước đỏ/sau xanh.
- [x] cargo check --locked --all-targets pass trên Windows với compiler đang cài.
- [ ] Toàn project pass trên Windows/Linux/macOS với Rust 1.97.0 theo acceptance.

### Acceptance / Verification plan
`cargo check --all-targets` pass trên ubuntu-latest, windows-latest và macos-latest.

Các lệnh và phép kiểm tra ở đây dành cho lúc task được duyệt và thực hiện. Ngưỡng nào được nguồn ghi là đề xuất thì cần chốt theo baseline. Nếu claim đã hết đúng, ghi bằng chứng và điều chỉnh task trước khi sửa.

### Steps
- [x] Step 1 — Đối chiếu mục 0.2 với hiện trạng; kiểm tra phụ thuộc → verify: ghi file/log/fixture hoặc quyết định còn thiếu.
- [x] Step 2 — Thực hiện phạm vi đã được duyệt → verify: đạt Requirements và các ràng buộc chung.
- [ ] Step 3 — Nghiệm thu và cập nhật ledger → verify: đáp ứng Acceptance bằng bằng chứng thực chạy hoặc xác nhận được ghi rõ.

### Handoff
- Branch: `main`
- Base commit: `7a7eb7f`
- Uncommitted files: src-tauri/src/bin/phase0_bench.rs và entry TASK-007 được chọn cho commit riêng; phần plan Pending khác không đưa vào commit.
- Next action: Sau khi TASK-015 bổ sung macos-latest, chạy cargo check --locked --all-targets bằng Rust 1.97.0 trên Windows/Linux/macOS; bổ sung bằng chứng CI rồi mới đánh dấu Done.
- Blockers: CI macOS chưa có trong matrix hiện tại; toolchain cài trên máy là Rust 1.99.0 thay vì bản ghim 1.97.0.

### Verification
Đã chạy trên Windows với Rust 1.99.0:
- Trước sửa: cargo check --locked --all-targets exit 0; nhánh unix không được kiểm tra bởi lệnh này.
- Probe trích nguyên nhánh unix trước sửa: rustc --crate-type lib --emit metadata trả E0515.
- Sau sửa: cargo check --locked --all-targets exit 0; probe nhánh unix từ source đã sửa compile thành công.
- git diff --check pass. Diff chỉ bỏ gate import Command và chuyển parse RSS vào closure sở hữu String; không đổi thuật toán đo.

Chưa chạy cargo check toàn project trên Linux/macOS hoặc bằng Rust 1.97.0. Probe kiểm chứng borrow-check của code trích xuất, không thay thế kiểm tra native trên từng OS. Vì vậy chưa đủ tiêu chí Done.

Phát hiện để TASK-036 xử lý khi chạy harness macOS: nhánh cfg(unix) hiện đọc /proc/self/status, vốn không có trên macOS; đây là vấn đề runtime baseline khác với hai lỗi compile của TASK-007.

### Log
- 2026-10-18 — Tạo đề xuất Pending từ tài liệu nguồn; chưa triển khai.

- 2026-10-18 — TASK-005 đã chốt phạm vi (DEC-003); cập nhật kế hoạch nghiệm thu, task vẫn Pending và chưa triển khai.
- 2026-10-18 — Bắt đầu theo yêu cầu sau khi commit TASK-006. Xác nhận Command chỉ import ở windows nhưng dùng trong run_child_sample không gate; nhánh unix trả &str mượn từ String trong closure. Khởi chạy cargo check --locked --all-targets trên Windows.

- 2026-10-18 — Step 1 hoàn tất: Windows all-targets pass ở baseline; probe nhánh Unix trích nguyên từ source báo E0515. Step 2: bỏ gate import Command và parse số bên trong closure sở hữu status.
- 2026-10-18 — Step 2 hoàn tất, kiểm tra Windows và probe Unix pass; chuẩn bị commit riêng thay đổi đã kiểm chứng. Step 3 còn thiếu CI native ba OS/toolchain ghim; Paused khi bàn giao, không đánh dấu Done. Hash commit ghi trong task.md → Commit log.
