# Kế hoạch triển khai & TDD: Phase 1 — Core Data Layer

Dưới đây là tài liệu Thiết kế & Kế hoạch triển khai kèm theo chiến lược TDD (Test-Driven Development) cho phần lưu trữ dữ liệu cốt lõi (Core Data Layer).

## 1. Thiết kế & Kiến trúc

### Collection Manifest & Storage
Các file Collection JSON sẽ được đặt tên theo định dạng `{collection_id}.json` (sử dụng UUID) thay vì tên hiển thị của Collection. Điều này tránh xung đột ký tự đặc biệt trên hệ điều hành và giúp việc đổi tên Collection diễn ra nhanh chóng mà không cần rename file vật lý trên disk.

Các file sẽ được lưu trữ tại thư mục dữ liệu ứng dụng: `<app-data>/.collections/`.

#### Cấu trúc file:
- `mod.rs`: Module exports.
- `model.rs`: Định nghĩa các cấu trúc dữ liệu tương thích 1-1 với TypeScript.
  - Enum `Entry` sử dụng tag `type` (kebab-case) để map với `"file"`, `"folder-ref"`, `"group"`.
  - Struct `Collection` sử dụng camelCase cho các thuộc tính JSON (`schemaVersion`, `createdAt`, `updatedAt`).
- `manager.rs`: Triển khai các hàm CRUD (ghi đè an toàn thông qua ghi file `.tmp` trước rồi `rename`), kiểm tra tính duy nhất của tên Collection (case-insensitive).

### Settings Storage
Quản lý cấu hình toàn ứng dụng (`settings.json`) chứa theme, font, và tỉ lệ thu phóng chữ.
- Hàm `load_settings` tự động tạo theme mặc định (theme sáng ngả cát ấm giống Claude Web UI) nếu chưa có cấu hình.
- Hàm `save_settings` cập nhật cấu hình xuống disk.

### Link Indexing (SQLite)
Thiết lập cơ sở dữ liệu SQLite `link-index.db` quản lý liên kết và cross-reference. Kết nối bằng cơ chế `bundled` của crate `rusqlite`, đảm bảo chạy native độc lập không phụ thuộc vào thư viện SQLite cài trên máy của người dùng.

#### Schema bảng `link_index`:
```sql
CREATE TABLE IF NOT EXISTS link_index (
    display_name TEXT NOT NULL,
    collection_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    path TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    PRIMARY KEY (collection_id, entry_id)
);
CREATE INDEX IF NOT EXISTS idx_display_name ON link_index(display_name);
```

---

## 2. Chiến lược TDD (Test-Driven Development) & Kết quả kiểm thử

Chúng ta thực hiện viết unit tests song song với việc phát triển code tại phần backend Rust (nằm trong các block `mod tests` ở cuối mỗi file code tương ứng) sử dụng thư mục tạm thời `tempfile` để không ảnh hưởng đến dữ liệu thực của người dùng.

### Các kịch bản kiểm thử (Test Cases) đã triển khai:

#### A. Kiểm thử Collection Manager (`collection/manager.rs`)
1. **CRUD Manifest**:
   - Lưu một collection mới vào thư mục tạm thời.
   - Nạp lại collection bằng ID và đối chiếu dữ liệu (tất cả các trường bao gồm `entries` lồng nhau khớp hoàn toàn).
   - Xóa collection và xác minh file đã bị xóa khỏi đĩa.
2. **Kiểm tra tính duy nhất của tên (Unique Name constraint)**:
   - Lưu một collection với tên `"My Notes"`.
   - Tạo thêm collection thứ hai với tên `"my notes"` (khác case) và xác minh hàm lưu trả về lỗi cảnh báo trùng tên (case-insensitive).
   - Cập nhật một collection hiện có mà không đổi tên (vẫn giữ nguyên tên cũ) và xác minh nó không tự báo lỗi trùng với chính nó.

#### B. Kiểm thử Settings (`settings.rs`)
1. **Cài đặt mặc định**:
   - Nạp settings từ một đường dẫn không tồn tại và xác minh cấu hình mặc định (theme sáng, font scale = 1.0) được trả về.
2. **Lưu & Tải Settings**:
   - Lưu cấu hình tùy chỉnh (dark theme, font "Inter", scale = 1.2) xuống file tạm.
   - Nạp lại file đó và đối chiếu các thông số cấu hình.

#### C. Kiểm thử SQLite Link Index (`link_index.rs`)
1. **Khởi tạo Database**:
   - Khởi tạo SQLite tại đường dẫn tạm và kiểm tra việc tạo bảng/index thành công.
2. **Thao tác thêm/xóa Index Entry**:
   - Thêm các bản ghi liên kết kiểu file (`"file"`) và thư mục (`"folder-ref"`).
   - Kiểm tra số lượng bản ghi trong database tăng lên tương ứng.
   - Xóa thử một entry và kiểm tra số lượng bản ghi giảm xuống.
3. **Thuật toán trích xuất tên hiển thị (Display Name Extraction)**:
   - Xác minh khi duyệt đệ quy cây mục lục:
     - File có đuôi `.md` (ví dụ: `d:/notes/Note A.md`) phải được trích xuất display name là `"Note A"` (bỏ đuôi `.md`).
     - File không phải `.md` (ví dụ: `d:/notes/image.png`) phải giữ nguyên tên file là `"image.png"`.
     - Thư mục vật lý (`folder-ref`) phải lấy tên thư mục cuối cùng làm tên hiển thị.

---

## 3. Cách chạy kiểm thử tự động
Bạn có thể kiểm chứng lại toàn bộ các bộ test TDD trên ở môi trường cục bộ bằng cách chạy lệnh sau tại thư mục gốc:

```powershell
# Chạy toàn bộ unit test ở backend Rust
cd src-tauri
cargo test
```
