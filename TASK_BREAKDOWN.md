# Task Breakdown: Phase 1 — Core Data Layer

Dưới đây là bảng phân rã công việc (Task Breakdown) cho Phase 1 của dự án. Tất cả các tác vụ này đã được hoàn thành ở phần Backend (Rust).

- [x] **T1.1 Định nghĩa Struct & Model Rust (`collection/model.rs`)**
  - Khai báo enum `Entry` (`File`, `FolderRef`, `Group`) ánh xạ JSON qua tag `type` (kebab-case).
  - Khai báo struct `Collection` ánh xạ camelCase cho các thuộc tính JSON.
  
- [x] **T1.2 Xây dựng CRUD & Name Uniqueness cho Collection (`collection/manager.rs`)**
  - Triển khai lưu trữ JSON (`{id}.json`) tại thư mục ứng dụng `.collections`.
  - Hỗ trợ cơ chế ghi file nguyên tử (ghi ra file `.tmp` trước rồi `rename` sang file chính).
  - Kiểm tra ràng buộc case-insensitive unique cho tên collection khi tạo mới/cập nhật.

- [x] **T1.3 Quản lý Cấu Hình Toàn Cục (`settings.rs`)**
  - CRUD cho file cấu hình `settings.json` (theme, font_body, font_mono, font_scale).
  - Trả về cấu hình mặc định (light theme ngả cát ấm giống Claude Web UI) nếu chưa có cấu hình.

- [x] **T1.4 Thiết lập SQLite Link Index (`link_index.rs`)**
  - Khởi tạo file SQLite `link-index.db` và tạo bảng `link_index` + chỉ mục nhanh `idx_display_name`.
  - Viết các hàm thêm/sửa/xóa liên kết, dọn dẹp liên kết của một Collection.
  - Viết hàm `rebuild_index_from_collections` duyệt đệ quy cây cấu trúc để tái tạo chỉ mục.
  - Viết hàm `update_index_for_collection` cập nhật nhanh liên kết của một Collection cụ thể.

- [x] **T1.5 Tích hợp Tauri Commands & Đăng ký IPC (`commands.rs` & `lib.rs`)**
  - Tạo các commands: `get_collections`, `create_collection`, `update_collection`, `delete_collection`, `load_settings`, `save_settings`.
  - Đăng ký các commands trên vào Tauri Builder.

- [x] **T1.6 Bổ dung Rust Unit & Integration Tests**
  - Tạo bộ test độc lập dùng thư mục tạm (`tempfile`) cho `collection/manager.rs`, `settings.rs`, `link_index.rs`.
  - Xác minh CRUD, unique name check, settings load/save và thuật toán đệ quy trích xuất tên note trong Link Index.
