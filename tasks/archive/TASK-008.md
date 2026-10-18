## TASK-008 — Đưa Rust fmt, clippy và test về xanh

**State:** Done
**Current Step:** Step 3 — Complete trên Windows
**Phase:** Phase 0
**Source ID:** 0.3

### Description
Đã đối chiếu và đưa quality gate Rust Windows về xanh theo mục 0.3. Baseline clippy không có warning; chỉ chuẩn hóa định dạng hai file để fmt check pass. Linux/macOS và toolchain CI ghim được kiểm chứng riêng tại TASK-086.

### Scope
- src-tauri/src/repositories/documents.rs
- src-tauri/

### Related
- [Kế hoạch duyệt, gates và ràng buộc chung](../plans/collectives-fix-rebuild-review.md)
- [Bản lưu tài liệu nguồn](../plans/collectives-fix-rebuild-source-2026-10-18.md) → 0.3

- [Quyết định đã duyệt trong TASK-005](../../decisions.md) → DEC-003

### Dependencies
[TASK-007](./TASK-007.md)

### Requirements
- [x] cargo clippy --locked --all-targets -- -D warnings exit 0 trên Windows; needless_return không tái hiện nên không sửa logic suy đoán.
- [x] cargo fmt --all --check exit 0 sau chuẩn hóa định dạng hai file.
- [x] cargo test --locked --all-targets exit 0 trên Windows.
- [x] Kiểm chứng native Linux/macOS và toolchain CI đã tách sang TASK-086.

### Acceptance / Verification plan
Nghiệm thu task này trên Windows: cargo clippy --locked --all-targets -- -D warnings, cargo fmt --all --check và cargo test --locked --all-targets đều exit 0. Kiểm chứng native Linux/macOS và đối chiếu toolchain CI ghim được chuyển TASK-086 theo yêu cầu người dùng.

Các lệnh và phép kiểm tra ở đây dành cho lúc task được duyệt và thực hiện. Ngưỡng nào được nguồn ghi là đề xuất thì cần chốt theo baseline. Nếu claim đã hết đúng, ghi bằng chứng và điều chỉnh task trước khi sửa.

### Steps
- [x] Step 1 — Đối chiếu mục 0.3 với hiện trạng; kiểm tra phụ thuộc → verify: ghi file/log/fixture hoặc quyết định còn thiếu.
- [x] Step 2 — Thực hiện phạm vi đã được duyệt → verify: đạt Requirements và các ràng buộc chung.
- [x] Step 3 — Nghiệm thu và cập nhật ledger → verify: đáp ứng Acceptance bằng bằng chứng thực chạy hoặc xác nhận được ghi rõ.

### Handoff
- Branch: `main`
- Base commit: `dd8b350`
- Uncommitted files: src-tauri/src/lib.rs, src-tauri/src/repositories/documents.rs và entry TASK-008 được commit riêng; các tài liệu kế hoạch khác giữ ngoài commit.
- Next action: none cho TASK-008; TASK-009 tiếp theo vẫn Pending. TASK-086 giữ kiểm chứng Linux/macOS.
- Blockers: none; kiểm chứng Linux/macOS và toolchain CI đã chuyển TASK-086.

### Verification
Baseline trên Windows Rust 1.99.0: cargo fmt --all -- --check exit 1 ở src/lib.rs và src/repositories/documents.rs; clippy --locked --all-targets -- -D warnings exit 0. Không tái hiện needless_return trên Windows.

Sau sửa, canonical gate `node scripts/phase0/verify-quality.mjs backend` exit 0, status pass:
- cargo fmt --all -- --check: exit 0.
- cargo clippy --locked --all-targets -- -D warnings: exit 0, không warning clippy.
- cargo test --locked --all-targets: exit 0, mọi target/test pass.
- git diff --check pass; diff source chỉ thay định dạng.

Bằng chứng: [quality-backend-20261018154350365.json](../../artifacts/phase0/quality-logs/quality-backend-20261018154350365.json). Test link Windows có cảnh báo LNK4098 về MSVCRTD nhưng không fail lệnh; không tuyên bố build không có warning linker. Rust được dùng là 1.99.0; native Linux/macOS và đối chiếu Rust 1.97.0 theo TASK-086. Không thay hành vi người dùng nên không thêm changelog.

### Log
- 2026-10-18 — Tạo đề xuất Pending từ tài liệu nguồn; chưa triển khai.

- 2026-10-18 — TASK-005 đã chốt phạm vi (DEC-003); cập nhật kế hoạch nghiệm thu, task vẫn Pending và chưa triển khai.
- 2026-10-18 — Người dùng yêu cầu triển khai TASK-008 theo nghiệm thu Windows trước; TASK-007 đã Done/commit d8454e8. TASK-086 giữ kiểm chứng Linux/macOS. Máy có rustfmt/clippy Rust 1.99.0; bắt đầu baseline.
- 2026-10-18 — Step 1 hoàn tất: fmt fail ở hai file, clippy Windows pass không warning. Không sửa speculative needless_return khi chưa có diagnostic trên Windows; checks nền tảng khác giữ tại TASK-086. Step 2 chạy rustfmt theo gate chuẩn.
- 2026-10-18 — Step 2 hoàn tất: cargo fmt chỉ đổi thứ tự module trong src/lib.rs và xuống dòng 3 lời gọi unsupported_error tại repositories/documents.rs; không đổi logic. Step 3 chạy node scripts/phase0/verify-quality.mjs backend (fmt, clippy, cargo test).
- 2026-10-18 — Step 3 hoàn tất: ba gate Rust Windows exit 0; ghi artifact và cảnh báo linker LNK4098. TASK-008 Done theo DEC-008, chuẩn bị commit riêng; hash lưu ở task.md → Commit log.
