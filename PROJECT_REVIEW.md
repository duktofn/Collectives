# Collection — Project Status Review

> **Ngày review:** 2026-06-24  
> **Commit hiện tại:** `31713a6` — *feat: scaffold app and implement core data layer (Phase 0 & 1)*  
> **Branch:** `master` (duy nhất) · Working tree sạch, không có thay đổi chưa commit.
>
> 📂 **Tài liệu tham chiếu liên quan:**
> - [Kế hoạch TDD & Kiểm thử](file:///d:/Code/Collection/TDD_PLAN.md)
> - [Bảng phân rã công việc (Task Breakdown)](file:///d:/Code/Collection/TASK_BREAKDOWN.md)

---


## 1. Tổng quan kiến trúc

| Layer | Công nghệ | Ghi chú |
|-------|-----------|---------|
| **Desktop Shell** | Tauri v2 | Identifier: `com.collection.note` |
| **Frontend** | SolidJS + TypeScript + Vite | Port dev: `1420` |
| **Backend** | Rust (Tauri commands) | SQLite (rusqlite), JSON file storage |
| **Styling** | Vanilla CSS | Dark-mode support qua `prefers-color-scheme` |
| **Testing** | Vitest (frontend), `cargo test` (backend) | CI chạy trên GitHub Actions |
| **Code Quality** | ESLint + Prettier + Clippy + rustfmt | Cấu hình đầy đủ |

### Sơ đồ module backend (Rust)

```
src-tauri/src/
├── main.rs              ← Entry point (windows_subsystem)
├── lib.rs               ← Tauri Builder + đăng ký commands
├── commands.rs          ← 7 Tauri commands (IPC layer)
├── settings.rs          ← Settings CRUD + model
├── link_index.rs        ← SQLite index cho cross-reference
└── collection/
    ├── mod.rs           ← Re-exports
    ├── model.rs         ← Data model (Collection, Entry enum)
    └── manager.rs       ← File-based CRUD + validation
```

---

## 2. Data Model

### Collection (`collection/model.rs`)

```rust
struct Collection {
    id: String,              // UUID v4
    schema_version: u32,     // Hiện tại: 1
    name: String,
    created_at: String,      // RFC 3339
    updated_at: String,
    entries: Vec<Entry>,
}
```

### Entry (tagged enum, serde `kebab-case`)

| Variant | Trường | Mô tả |
|---------|--------|-------|
| `File` | `id`, `path` | Tham chiếu đến 1 file trên disk |
| `FolderRef` | `id`, `path` | Tham chiếu đến 1 folder |
| `Group` | `id`, `name`, `children: Vec<Entry>` | Nhóm ảo, hỗ trợ lồng nhau (nested) |

### Settings (`settings.rs`)

```rust
struct Settings {
    theme: String,           // "light" / "dark"
    font_body: Option<String>,
    font_mono: Option<String>,
    font_scale: f32,         // Default: 1.0
}
```

---

## 3. Tính năng đã triển khai

### ✅ Backend (Rust) — Hoàn thiện Phase 0 & 1

| Tính năng | File | Trạng thái |
|-----------|------|-----------|
| CRUD Collection (tạo/đọc/sửa/xóa) | `commands.rs`, `manager.rs` | ✅ Hoàn thành |
| Lưu trữ Collection dạng JSON file | `manager.rs` | ✅ Atomic write (tmp → rename) |
| Validate tên Collection (case-insensitive unique) | `manager.rs` | ✅ Hoàn thành |
| Settings load/save (JSON) | `settings.rs` | ✅ Hoàn thành |
| Link Index (SQLite) | `link_index.rs` | ✅ CRUD + rebuild + transaction batch |
| Tự động cập nhật `updated_at` khi update | `commands.rs` | ✅ Hoàn thành |
| Sync link index khi update/delete collection | `commands.rs` | ✅ Hoàn thành |
| Unit tests cho tất cả modules | `manager.rs`, `settings.rs`, `link_index.rs` | ✅ Hoàn thành |

### ❌ Frontend (SolidJS) — Chưa triển khai

| Tính năng | Trạng thái |
|-----------|-----------|
| UI hiển thị danh sách Collections | ❌ Chưa làm |
| Form tạo/sửa/xóa Collection | ❌ Chưa làm |
| Editor (CodeMirror) cho markdown | ❌ Chưa làm (dependency đã cài) |
| Router/Navigation | ❌ Chưa làm (`@solidjs/router` đã cài) |
| Chart visualization | ❌ Chưa làm (`chart.js` đã cài) |
| Settings UI | ❌ Chưa làm |

> **Lưu ý:** Frontend hiện tại vẫn là template mặc định của Tauri + SolidJS (logo + greet form).

---

## 4. Dependencies đáng chú ý

### Frontend (npm)

| Package | Version | Mục đích | Đã sử dụng? |
|---------|---------|----------|-------------|
| `solid-js` | ^1.9.3 | UI framework | ✅ (template) |
| `@solidjs/router` | ^0.16.1 | Routing | ❌ Chưa |
| `@tauri-apps/api` | ^2 | Tauri IPC | ✅ (greet) |
| `@codemirror/*` | ^6.x | Code/Markdown editor | ❌ Chưa |
| `@lezer/markdown` | ^1.6.4 | Markdown parser cho CodeMirror | ❌ Chưa |
| `chart.js` | ^4.5.1 | Chart visualization | ❌ Chưa |
| `js-yaml` | ^5.1.0 | YAML parsing | ❌ Chưa |

### Backend (Cargo)

| Crate | Mục đích | Đã sử dụng? |
|-------|----------|-------------|
| `tauri` v2 | Desktop framework | ✅ |
| `serde` + `serde_json` | Serialization | ✅ |
| `uuid` v1.8 (v4) | ID generation | ✅ |
| `rusqlite` 0.31 (bundled) | SQLite cho link index | ✅ |
| `chrono` 0.4.38 | Timestamp | ✅ |
| `blake3` 1.5.1 | Hashing | ❌ Chưa |
| `file-id` 0.2.1 | File identity | ❌ Chưa |
| `notify` 6.1.1 | File watcher | ❌ Chưa |
| `zip` 1.1.4 | Archive support | ❌ Chưa |

---

## 5. CI/CD

File: `.github/workflows/ci.yml`

| Job | Runs-on | Bước |
|-----|---------|------|
| **frontend** | `ubuntu-latest` | `npm install` → `npm run lint` → `vitest --run` |
| **backend** | `ubuntu-latest` + `windows-latest` | `cargo fmt --check` → `cargo clippy -D warnings` → `cargo test` |

> CI pipeline đầy đủ và chạy trên cả Linux + Windows cho backend.

---

## 6. Đánh giá code quality

### 👍 Điểm tốt

1. **Tách biệt rõ ràng giữa logic core và Tauri wrappers** — Mỗi module (`manager.rs`, `settings.rs`, `link_index.rs`) đều có các hàm `*_from_path` / `*_at_path` testable độc lập, không phụ thuộc vào `AppHandle`.
2. **Atomic file write** — Collection được ghi qua file `.tmp` rồi `rename`, tránh mất dữ liệu nếu crash giữa chừng.
3. **Transaction batch cho SQLite** — `rebuild_index_from_collections` và `update_index_for_collection` sử dụng `BEGIN TRANSACTION` / `COMMIT`.
4. **Unit tests có ý nghĩa** — Coverage cho cả CRUD, uniqueness validation, nested Entry extraction, settings roundtrip.
5. **CI/CD cấu hình chặt** — Clippy `-D warnings`, rustfmt check, lint cả frontend và backend.

### ⚠️ Điểm cần cải thiện

1. **Frontend chưa có gì** — Vẫn là template mặc định. Tất cả 7 Tauri commands đã sẵn sàng nhưng frontend chưa gọi đến (trừ `greet`).
2. **`greet` command vẫn còn** — Là code demo, nên xóa khi bắt đầu xây UI thực.
3. **Error handling dùng `String`** — Backend trả lỗi dạng `Result<_, String>`. Nên xem xét tạo custom error enum khi project phức tạp hơn.
4. **Thiếu `Cargo.lock` trong repo** — Đối với application (không phải library), nên commit `Cargo.lock` để đảm bảo reproducible build.
5. **`.gitignore` quá đơn giản** — Chỉ có `node_modules` và `dist`. Thiếu: `src-tauri/target/`, `*.db`, `.env`, v.v.
6. **`dist/` folder đang có trong repo** — Thư mục build output không nên được commit (đã có trong `.gitignore` nhưng vẫn tồn tại).
7. **CSP = null** — `tauri.conf.json` set `"csp": null`, tắt Content Security Policy. Cần cấu hình CSP hợp lý trước khi release.
8. **Chưa có `fs` permission** — Tauri capabilities chỉ có `core:default` và `opener:default`. Khi UI cần đọc/ghi file (editor), sẽ cần thêm `fs` permissions.
9. **Dependencies chưa dùng** — `blake3`, `file-id`, `notify`, `zip` (Rust) và `@codemirror/*`, `chart.js`, `js-yaml` (npm) đã cài nhưng chưa sử dụng.

---

## 7. Cấu trúc file tổng hợp

```
Collection/
├── .github/workflows/ci.yml     # CI pipeline
├── .vscode/extensions.json      # Recommended extensions
├── .gitignore
├── .prettierrc                   # Code formatting
├── eslint.config.js              # Linting
├── index.html                    # SPA entry
├── package.json                  # npm config
├── tsconfig.json                 # TypeScript config
├── tsconfig.node.json
├── vite.config.ts                # Vite + Vitest config
│
├── public/                       # Static assets
│   ├── tauri.svg
│   └── vite.svg
│
├── src/                          # Frontend (SolidJS + TS)
│   ├── index.tsx                 # App mount point
│   ├── App.tsx                   # Root component (template)
│   ├── App.css                   # Styles (template)
│   ├── App.test.tsx              # Basic test
│   └── assets/logo.svg
│
├── src-tauri/                    # Backend (Rust + Tauri v2)
│   ├── Cargo.toml
│   ├── build.rs
│   ├── tauri.conf.json
│   ├── capabilities/default.json
│   ├── icons/                    # App icons
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       ├── commands.rs           # 7 IPC commands
│       ├── settings.rs           # Settings CRUD + tests
│       ├── link_index.rs         # SQLite index + tests
│       └── collection/
│           ├── mod.rs
│           ├── model.rs          # Data model
│           └── manager.rs        # File CRUD + tests
│
└── dist/                         # Build output (nên xóa khỏi git)
```

---

## 8. Tóm tắt trạng thái

| Phần | Tiến độ | Ghi chú |
|------|---------|---------|
| **Scaffold & Config** | ✅ 100% | Tauri + Solid + Vite + CI |
| **Backend Data Layer** | ✅ 100% | Collection CRUD, Settings, Link Index |
| **Backend Tests** | ✅ 100% | 3 test suites, cover happy + edge cases |
| **Frontend UI** | ❌ 0% | Vẫn là template mặc định |
| **Frontend ↔ Backend Integration** | ❌ ~5% | Chỉ có `greet` command hoạt động |

> **Kết luận:** Project đã hoàn thành Phase 0 (scaffold) và Phase 1 (core data layer) với chất lượng code tốt. Backend sẵn sàng để frontend kết nối. Bước tiếp theo là xây dựng UI — bắt đầu từ màn hình quản lý Collections, sau đó tích hợp editor (CodeMirror) cho nội dung markdown.
