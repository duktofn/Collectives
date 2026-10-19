## TASK-086 — Kiểm chứng Linux và macOS sau các task chạy Windows

**State:** Paused
**Current Step:** Chờ triển khai runner và thu bằng chứng native

### Description
Tách kiểm chứng Linux/macOS khỏi nghiệm thu Windows theo yêu cầu trực tiếp của người dùng. Các task được Done sau khi đạt checks Windows; kết quả đó không được coi là bằng chứng đã pass trên Linux/macOS.

### Scope
- CI ubuntu-latest và macos-latest; đối chiếu toolchain ghim Rust 1.97.0
- Kiểm chứng bổ sung TASK-007, TASK-008 và các kiểm tra Linux/macOS tiếp tục được chuyển về task này
- artifacts/log kiểm tra và báo cáo khác biệt nền tảng; không chạy benchmark giả thay cho native

### Related
- [TASK-007](./TASK-007.md), [TASK-008](./TASK-008.md), [TASK-015](./TASK-015.md)
- [DEC-003 và DEC-008](../../decisions.md)
- [Kế hoạch](../plans/collectives-fix-rebuild-review.md)

### Dependencies
TASK-015 bổ sung runner macOS; bản sửa TASK-007 và TASK-008 đã commit.

### Requirements
- [ ] cargo check --locked --all-targets pass native trên Linux và macOS.
- [ ] cargo fmt --all --check, cargo clippy --locked --all-targets -- -D warnings và cargo test --locked --all-targets pass native trên Linux và macOS.
- [ ] Ghi phiên bản compiler; đối chiếu CI Rust 1.97.0 gồm runner Windows nếu máy dev đã dùng 1.99.0.
- [ ] Theo dõi các kiểm tra Linux/macOS được chuyển từ task sau, thu đủ log trước nghiệm thu toàn kế hoạch.
- [ ] Xác minh profile native libz-ng-sys của TASK-087 trên Linux/macOS cùng các gate Rust.
- [ ] Chạy ba spec code-block interaction, code-click-drift và editor-layout interaction của TASK-009 trên Linux/macOS; ghi kết quả caret/layout native.
- [ ] Chạy editor-floating-controls E2E và ContextMenu.a11y unit của TASK-010 trên Linux/macOS; xác minh clipboard, menu con, phím điều hướng và focus.
- [ ] Phân loại lỗi nền tảng, sửa trong task sở hữu hoặc tạo task sửa riêng; giữ yêu cầu hỗ trợ cả ba OS.

- [ ] Chạy các hồi quy Quick Open TASK-011 và caret/inline-formatting TASK-012 trên Linux/macOS.

- [ ] Xác minh TASK-015 trên Actions: khi Linux lỗi, Windows/macOS vẫn có kết quả riêng với fail-fast=false; ba OS đều được chạy.
- [ ] Chạy npm run test:hooks trên Linux/macOS cho TASK-013.

### Steps
- [ ] Step 1 — Chuẩn bị runner/CI và revision cần kiểm tra → verify: runner, compiler và commit được ghi rõ.
- [ ] Step 2 — Chạy checks native và xử lý sai khác → verify: lệnh, exit code và log mỗi OS.
- [ ] Step 3 — Tổng hợp và nghiệm thu → verify: tất cả checks đã chuyển được ghi pass hoặc lỗi đã được giải quyết.

### Handoff
- Branch: main
- Base commit: ac0236a
- Uncommitted files: chỉ tài liệu phân tách kiểm chứng, chưa sửa CI hoặc code cho task này.
- Next action: Sau TASK-015, chạy bốn gate Rust native trên Linux/macOS; đối chiếu toolchain ghim và ghi kết quả từng task.
- Blockers: runner macOS chưa có trong matrix CI hiện tại.

### Verification
Chưa chạy Linux/macOS. TASK-007 đã có cargo check trên Windows Rust 1.99.0 và probe Unix trích từ source; đây không phải kiểm tra native Linux/macOS.

### Log
- 2026-10-18 — Người dùng yêu cầu tạo task mới cho Linux/macOS, chạy Windows trước và đánh Done nếu Windows đạt. Tạo Pending để giữ phần kiểm chứng còn lại.
- 2026-10-18 — Bổ sung follow-up profile native TASK-087 và hồi quy trình duyệt TASK-009; các kiểm tra Linux/macOS chưa chạy.
- 2026-10-18 — TASK-010 đã pass Windows: 6 E2E, 3 unit, 9 lượt lặp; bổ sung phần kiểm chứng tương ứng trên Linux/macOS, vẫn Pending.
- 2026-10-19 — Bổ sung Quick Open/caret theo TASK-011 và TASK-012; Windows đã đạt, Linux/macOS chưa chạy.
- 2026-10-19 — TASK-015 đã đạt kiểm tra YAML trên Windows; phần native matrix/false fail-fast và hooks các OS được ghi ở đây để kiểm chứng trên runner thật.

- 2026-10-19 — User requested Windows-only focus (TASK-089). Native Linux/macOS work paused. Existing CI evidence: Unix clippy needless_return in import_transaction.rs:133; macOS four import/collection tests reject symlink paths; Linux three browser failures. Logs: artifacts/task014/macos-job.log, linux-backend.log, linux-browser.log. Resume only when explicitly requested.
