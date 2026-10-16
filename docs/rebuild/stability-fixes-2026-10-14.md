# Collectives — sửa lỗi và kiểm chứng ngày 2026-10-14

## Các thay đổi

- Save barrier lưu cả phần gõ thêm trong lúc ghi file, trước khi đóng hoặc chuyển ghi chú. Hàng đợi chỉ giữ bản mới nhất chưa bắt đầu ghi và dùng token của lần commit trước.
- Chỉ thay phiên editor khi file mới đã đọc thành công; giữ nội dung và Undo khi mở file lỗi. Lưu phần gõ thêm trong thời gian đọc file mới. Bỏ qua lỗi của lượt đọc đã bị thay thế và hủy lượt mở đang chờ khi đóng tài liệu.
- Khôi phục crash draft phải lưu được ghi chú hiện tại trước khi thay phiên; nếu lưu lỗi thì giữ cả ghi chú hiện tại và draft khôi phục.
- FolderRef phân biệt lượt đọc theo generation/invalidation. Chọn lại cùng file khi lượt cũ chưa xong không còn bị kẹt ở “checking”; kết quả cũ không xóa lượt đọc mới.
- Decoration của code block cập nhật khi parser hoàn thành sau thời hạn ban đầu. Test không phụ thuộc việc parse phải hoàn tất ngay trong lần mount.
- Chừa đủ khoảng trống cho nút điều khiển hàng của bảng ở bên phải. Test kiểm tra nút nằm trong khung và không che ô, đồng thời chờ cập nhật focus của CodeMirror.
- Đọc tài liệu có preflight dung lượng và bounded read, chống cấp phát toàn bộ file quá lớn hoặc file tăng kích thước trong lúc đọc. Save giải mã và lấy token từ cùng một bản bytes; bước kiểm token cuối dùng hash theo từng phần. Ghi/tạo tài liệu từ chối NUL và nội dung vượt giới hạn; file tạm được tạo độc quyền.
- Tìm kiếm dùng cùng chính sách đọc tài liệu, nhận cả `.md` và `.markdown`, bỏ qua file không đọc được bằng editor. Giới hạn số thư mục/mục thư mục được duyệt, sắp xếp con trước khi duyệt, giữ giới hạn tổng dung lượng.
- Chuyển đọc filesystem của content search vào document repository; service chỉ điều phối repository. Các kiểu kết quả tìm kiếm được xuất qua feature API. Cả hai kiểm tra ranh giới module đều qua.
- Test predecessor tự tạo dữ liệu trong thư mục tạm, kiểm tra hash/path/mode và tính chỉ-đọc, dọn fixture sau mỗi test. Không cần artifact từ máy cũ. Bỏ shebang gây lỗi khi Vitest đánh giá module; vẫn chạy được bằng `node --test`.
- Quy định LF cho bốn file được so sánh trực tiếp với generator, tránh báo stale chỉ vì Git checkout CRLF trên Windows.
- Playwright có cấu hình riêng cho phase 4/5/6. Lệnh mặc định chạy các regression sản phẩm; `npm run test:e2e` chạy thêm phase 6. CI chạy browser regressions và các kiểm tra contract/boundary. README cập nhật Node và yêu cầu build Windows.

## Kết quả xác nhận

Trước sửa: TypeScript/lint/build qua; Vitest có 44 file qua, một file test lỗi và một suite không load được. Năm regression mới về save/open/FolderRef đều đỏ trước patch và xanh sau patch.

Sau sửa:

| Kiểm tra | Kết quả |
| --- | --- |
| TypeScript | Qua |
| ESLint | Qua, không warning |
| Vitest | 46 file, 175 test qua |
| Test predecessor độc lập qua Node | 5 test qua |
| Playwright sản phẩm | 32 test qua |
| Playwright phase 6 | 5 test qua |
| Smoke cấu hình phase 4/5, dark/active ở ba viewport | 6 test qua |
| IPC/file-capabilities generators, handler registry, boundary checks | Qua |
| Frontend production build | Qua |
| Rust formatting/syntax | Qua |

37 test browser bao gồm code selection/click, Undo bảng, vị trí con trỏ, bảng cuộn ngang, workspace tối/sáng, viewport nhỏ, bàn phím, modal/settings, forced colors/reduced motion và harness hiệu năng.

## Xác nhận bổ sung ngày 2026-10-15

- Đã cài Microsoft Visual Studio Build Tools 2022 workload `Microsoft.VisualStudio.Workload.VCTools`, MSVC x64/x86 và Windows 11 SDK 10.0.26100.
- Đã chạy `cargo test --manifest-path src-tauri/Cargo.toml --locked --all-targets`: mọi unit test và integration test đều qua, bao gồm các test Rust mới về tìm kiếm `.markdown`, bỏ qua file không đọc được và từ chối nội dung vượt giới hạn hoặc có NUL.
- Đã chạy `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings`: qua.
- Đã chạy `npm run tauri -- dev`: Vite mở ở `http://localhost:1420/`; Tauri liên kết thành công và chạy `tauri-app.exe`.
- Linker phát cảnh báo `LNK4098` về runtime thư viện `MSVCRTD`, đã ghi nhận trong lần audit trước. Cảnh báo này không làm thất bại test, Clippy hoặc chạy ứng dụng.

Build frontend vẫn cảnh báo chunk chính khoảng 888 kB (291 kB gzip), vượt advisory 500 kB. Chưa thay cấu trúc bundle để che cảnh báo này. Browser tests không thay thế kiểm tra WebView2 native; tìm kiếm vẫn là scan có giới hạn và sidebar chưa được virtualize.
