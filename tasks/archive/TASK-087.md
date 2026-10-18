## TASK-087 — Sửa cảnh báo Windows linker LNK4098

**State:** Done
**Current Step:** Step 3 — Complete trên Windows

### Description
Điều tra và sửa cảnh báo MSVCRTD trong build/test Windows theo yêu cầu người dùng; xác minh cảnh báo biến mất mà các gate backend vẫn pass.

### Scope
- Cấu hình build Windows và native dependencies liên quan sau khi xác định nguyên nhân
- src-tauri/ và kiểm tra backend; log tại artifacts/task087/
- Task ledger, quyết định kỹ thuật nếu cần; không gộp TASK-009 vào commit

### Requirements
- [x] Xác định object/library thực sự yêu cầu runtime xung đột, có bằng chứng.
- [x] Sửa cấu hình hoặc thư viện đúng nguyên nhân; không chỉ che warning.
- [x] Build/test Windows không còn LNK4098; fmt/clippy và toàn bộ test pass.
- [x] Commit riêng TASK-087 trước khi bắt đầu TASK-009.

### Steps
- [x] Step 1 — Thu linker/native-library evidence → verify: chỉ ra thư viện và CRT cần liên kết.
- [x] Step 2 — Sửa nguyên nhân → verify: cấu hình native mới chọn CRT tương thích, không suppress linker.
- [x] Step 3 — Chạy gate và commit → verify: exit 0, không LNK4098; hash trong task.md.

### Handoff
- Branch: main
- Base commit: 052d6cb
- Uncommitted files: src-tauri/Cargo.toml và entry TASK-087 được chọn commit riêng; các task kế hoạch cũ giữ ngoài commit.
- Next action: none cho TASK-087; commit riêng rồi triển khai TASK-009.
- Blockers: none.

### Verification
Đã xác định zlibstatic-ngd.lib dùng MSVCRTD, còn các native library khác dùng MSVCRT. Sau package profile override, CMake active profile là RelWithDebInfo và zlibstatic-ng.lib mới có directives MSVCRT (không MSVCRTD). Bằng chứng tại artifacts/task087/native-directives-before.json và native-directives-after.json. Canonical backend gate đã pass toàn bộ trên Windows Rust 1.99.0: fmt, clippy -D warnings, cargo test --locked --all-targets đều exit 0. Kiểm tra toàn bộ stdout/stderr của cả ba lệnh không còn LNK4098. Bằng chứng [quality-backend-20261018161204055.json](../../artifacts/phase0/quality-logs/quality-backend-20261018161204055.json). Không thay Cargo.lock, compression backend, code archive hoặc release profile; native Linux/macOS theo TASK-086.

### Log
- 2026-10-18 — Tạo task trước khi sửa warning, theo yêu cầu người dùng; sau task này triển khai TASK-009.
- 2026-10-18 — dumpbin /directives xác định zlibstatic-ngd.lib từ libz-ng-sys 1.1.29 yêu cầu MSVCRTD; sqlite3/bzip2/zstd/vswhom yêu cầu MSVCRT. Bằng chứng lưu artifacts/task087/native-directives-before.json. Chọn opt-level=1 riêng cho libz-ng-sys ở dev (test kế thừa), để CMake dùng RelWithDebInfo và CRT khớp Rust; không thêm NODEFAULTLIB.
- 2026-10-18 — CMake mới dùng RelWithDebInfo; dumpbin của zlibstatic-ng.lib mới xác nhận MSVCRT. fmt/clippy pass; canonical gate đang chạy toàn bộ test/link Windows. Quyết định được ghi tại DEC-009.
- 2026-10-18 — Step 3 hoàn tất: tất cả gate backend pass, không LNK4098; directives library mới là MSVCRT. TASK-087 Done, chuẩn bị commit riêng Cargo.toml và task entry; hash ở task.md → Commit log. DEC-009 ghi lựa chọn profile.
