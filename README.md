# Collectives

**Collectives** là một ứng dụng ghi chú và quản lý tri thức cá nhân (Personal Knowledge Management - PKM) cục bộ (local-first), bảo mật và đa nền tảng. Dự án được phát triển dựa trên hiệu năng vượt trội của **Rust (Tauri v2)** ở phần backend và giao diện phản hồi nhanh nhẹn từ **SolidJS** cùng trình soạn thảo **CodeMirror 6** ở frontend.

Giống như Obsidian hay Logseq, Collectives giúp bạn liên kết các ý tưởng, quản lý thư mục tài liệu sẵn có mà không làm thay đổi cấu trúc vật lý của chúng trên ổ đĩa, đồng thời hỗ trợ các tính năng nâng cao như vẽ biểu đồ trực tiếp từ Markdown, bảng tương tác, tự động hoàn thành liên kết Wiki, và theo dõi thay đổi file theo thời gian thực.

---

## 🌟 Tính Năng Nổi Bật

### 1. Kiến Trúc Cục Bộ (Local-First) & Tự Chủ Dữ Liệu
* **Không lưu trữ đám mây bắt buộc:** Mọi dữ liệu (ghi chú, hình ảnh, tài liệu) được lưu trực tiếp trên ổ cứng dưới định dạng file Markdown (`.md`) và cấu trúc thư mục tiêu chuẩn. Bạn hoàn toàn sở hữu dữ liệu của mình.
* **Liên kết thư mục ngoài (Folder References):** Bạn có thể tham chiếu trực tiếp đến các thư mục hiện có trên máy tính của mình mà không cần sao chép chúng vào thư mục cài đặt của ứng dụng.

### 2. Trình Soạn Thảo Markdown Hiện Đại (CodeMirror 6)
* **Giao diện soạn thảo trực quan (Live Decorations):** Tự động render định dạng Markdown (tiêu đề, chữ in đậm/nghiêng, danh sách, khối trích dẫn) ngay trong chế độ soạn thảo giúp trải nghiệm viết mượt mà.
* **Bảng tương tác (Interactive Tables):** Tự động chuyển đổi các bảng Markdown thô kệch thành các bảng HTML trực quan, dễ đọc và dễ biên tập.
* **Biểu đồ động (Interactive Charts):** Hỗ trợ khai báo khối code `chart` bằng định dạng YAML. Ứng dụng sẽ tự động vẽ biểu đồ trực quan bằng **Chart.js** trực tiếp trong trình soạn thảo, hỗ trợ giao diện chỉnh sửa nhanh các thuộc tính biểu đồ.
* **Tự động lưu (Auto-save):** Cơ chế tự động lưu thông minh (sau 2 giây ngừng gõ phím hoặc giới hạn bắt buộc sau 15 giây khi gõ liên tục) giúp loại bỏ nỗi lo mất dữ liệu.

### 3. Hệ Thống Liên Kết Wiki (WikiLinks) & Tham Chiếu Khối (Block Refs)
* **Liên kết Wiki song phương:** Dễ dàng kết nối các ghi chú bằng cú pháp quen thuộc `[[Tên Ghi Chú]]`. Hệ thống hỗ trợ tự động gợi ý (Autocomplete) khi bạn đang gõ.
* **Tham chiếu tiêu đề & khối:** Liên kết đến một tiêu đề cụ thể bằng `[[Tên Ghi Chú#Tiêu đề]]` hoặc đến một khối văn bản bằng ID ngẫu nhiên `[[Tên Ghi Chú#^id-khoi]]` (tương tự như cú pháp của Obsidian). Khi nhấp vào liên kết, ứng dụng sẽ tự động cuộn đến đúng vị trí của tiêu đề/khối đó.
* **Định vị & Theo dõi tệp tin thông minh (File Identity Tracking):** Sử dụng các thuộc tính hệ thống của file để nhận diện các thay đổi vị trí hoặc đổi tên file diễn ra bên ngoài ứng dụng. Khi phát hiện một tệp tin bị di chuyển, ứng dụng sẽ tự động cập nhật lại các đường dẫn liên kết nội bộ để tránh tình trạng liên kết bị hỏng (broken links).

### 4. Giám Sát Tệp Tin Thời Gian Thực (File System Watcher)
* Phần backend viết bằng Rust sử dụng cơ chế lắng nghe sự kiện của hệ điều hành để phát hiện lập tức bất kỳ sự thay đổi nào (thêm mới, chỉnh sửa, xóa, đổi tên file) diễn ra trong các thư mục được tham chiếu, sau đó đồng bộ hóa ngay lập tức lên giao diện sidebar mà không cần tải lại trang.

### 5. Quản Lý Giao Diện & Font Chữ Linh Hoạt
* **Công cụ tùy chỉnh giao diện chuyên sâu (Theme Engine):** Settings gồm Appearance, Behavior và Shortcuts. Appearance chia thành Theme và Typography; quản lý font nằm trong Typography, còn bố cục note nằm trong Behavior. Các tab có hiệu ứng chuyển, dropdown dùng chung kiểu chọn theme, Line height và Font scale nhập trực tiếp bằng số. Theme gộp màu Interface, Note và Code, có theme mặc định chỉ đọc và thư viện custom theme với Save new / Replace. Khi trùng toàn bộ màu, ứng dụng cho chọn ghi đè custom theme trùng hoặc vẫn lưu mới. Có bản xem trước Java, C#, C++, Rust và Python, khôi phục từng nhóm màu và xuất/nhập theme JSON.
* **Theme có sẵn:** Pastel Light, Cerulean, Ice & Butter, Holst dùng nền sáng; Pastel Dark, Blues, Sicily, Desert Nights, Viola, Luigi, Cove, Pinheiro, Embers, Luna, Sunset, Violet Dusk, Ocean và Marple dùng nền tối. Mỗi preset có đầy đủ màu giao diện, nội dung và syntax; có thể lưu thành custom theme để chỉnh sửa. Các panel dùng viền hòa màu và bóng nhẹ để tạo hiệu ứng đảo nổi.
* **Khung cửa sổ:** Thanh tiêu đề và viền theo theme, hỗ trợ kéo cửa sổ, nhấp đúp để phóng to/khôi phục, thu nhỏ và đóng qua luồng lưu bản nháp hiện có.
* **Bố cục và tương tác:** Typography cho chọn cột nội dung ở giữa với độ rộng tùy chỉnh hoặc toàn chiều rộng. Sidebar có hiệu ứng mở/đóng, tự hiện khi rê chuột sát mép trái và tùy chọn tắt trong Behavior. Hai checkbox Code và Markdown bật/tắt riêng việc tô nền mờ các từ trùng với từ tại con trỏ.
* **Điều khiển editor:** Editor kéo dài ngang đáy sidebar; Read/Write/Source dùng cụm icon nổi ở góc dưới phải. Chấm cạnh tên file báo thay đổi chưa lưu và biến mất sau khi lưu. Menu chuột phải có Search in notes (điền sẵn chữ đang chọn), Copy/Cut/Paste (disable khi không dùng được), Select All, Heading 1–3, Table và Chart với Bar/Line/Area/Pie/Doughnut; bấm trực tiếp Chart tạo Bar. Copy path nằm trong menu file ở sidebar.
* **Quản lý Font chữ hệ thống & Custom Fonts:** Bạn có thể nhập trực tiếp các file font chữ cá nhân (`.ttf`, `.otf`, `.woff`, `.woff2`) vào ứng dụng để cá nhân hóa toàn diện trải nghiệm đọc/viết của mình.

### 6. Nhập/Xuất & Giải Quyết Xung Đột An Toàn
* Hỗ trợ xuất toàn bộ Collection thành định dạng thư mục hoặc file nén `.zip`.
* Khi nhập một file zip vào ứng dụng, một trình thuật sĩ (Wizard) giải quyết xung đột sẽ xuất hiện để hiển thị chi tiết các tệp trùng lặp và hướng dẫn bạn chọn đè lên (overwrite), bỏ qua (skip) hoặc đổi tên để đảm bảo an toàn tuyệt đối cho dữ liệu.

---

## 🛠️ Công Nghệ Sử Dụng

### Frontend
* **SolidJS:** Thư viện giao diện khai báo siêu nhanh với cơ chế phản ứng (fine-grained reactivity) không cần Virtual DOM.
* **CodeMirror 6:** Trình soạn thảo mã nguồn thế hệ mới, hỗ trợ tối đa việc viết các extension tùy biến cho định dạng Markdown, Auto-complete và Widget vẽ biểu đồ.
* **Chart.js:** Thư viện biểu đồ mạnh mẽ giúp render trực quan các khối dữ liệu YAML trong bài viết.
* **TypeScript:** Đảm bảo độ tin cậy và cấu trúc mã nguồn rõ ràng ở phía giao diện.

### Backend
* **Rust & Tauri v2:** Cung cấp hiệu năng vượt trội, dung lượng ứng dụng siêu nhẹ, giao tiếp an toàn giữa frontend và hệ điều hành thông qua Tauri IPC (Inter-Process Communication).
* **Notify crate:** Thư viện Rust dùng để lắng nghe sự thay đổi của File System ở mức hiệu năng cao.
* **Zip crate:** Xử lý nén/giải nén gói Collection trực tiếp ở backend nhằm đạt tốc độ tối đa.

---

## 📂 Cấu Trúc Thư Mục Dự Án

```text
Collectives/
├── src/                      # Mã nguồn Frontend (SolidJS + TypeScript)
│   ├── assets/               # Hình ảnh, icon tĩnh
│   ├── components/           # Các component UI chia nhỏ (Sidebar, Editor, Tree...)
│   ├── lib/                  # Các thư viện bổ trợ, logic tích hợp Tauri & CodeMirror extensions
│   │   ├── cm-extensions/    # Các tiện ích CodeMirror (Vẽ biểu đồ, bảng, WikiLinks...)
│   │   ├── wikilink/         # Bộ phân tích và xử lý liên kết Wiki
│   │   └── themeEngine.ts    # Logic áp dụng theme và đăng ký Font chữ động
│   ├── stores/               # Quản lý State toàn cục (Collections, Editor, UI)
│   └── App.tsx               # Entry point chính của ứng dụng Frontend
├── src-tauri/                # Mã nguồn Backend (Rust + Tauri Configuration)
│   ├── src/
│   │   ├── collection/       # Logic xử lý và quản lý Collection (Manager, model, zip archive)
│   │   ├── fs_layer/         # Bộ giám sát file (Watcher) & Nhận diện danh tính file (File Identity)
│   │   ├── commands.rs       # Tập hợp các Tauri commands giao tiếp với frontend
│   │   ├── link_index.rs     # Chỉ mục và tìm kiếm nhanh liên kết WikiLink
│   │   ├── font_manager.rs   # Logic cài đặt/xóa font chữ ở hệ thống cục bộ
│   │   ├── theme_io.rs       # Quản lý đọc/ghi các file cấu hình Theme
│   │   └── lib.rs            # Điểm khởi chạy ứng dụng Tauri và đăng ký commands
│   ├── Cargo.toml            # Khai báo dependencies của Rust
│   └── tauri.conf.json       # File cấu hình ứng dụng Tauri
├── package.json              # Khai báo dependencies của Node.js & NPM scripts
└── tsconfig.json             # Cấu hình TypeScript
```

---

## 🚀 Hướng Dẫn Cài Đặt & Phát Triển Cục Bộ

### Đóng gói bản phát hành

Mỗi bản phát hành có file `release/x.y.z/changelog.md`, lấy riêng mục `## [x.y.z]` trong [CHANGELOG.md](CHANGELOG.md). Bổ sung mục changelog đúng phiên bản trước khi build; quy trình sẽ dừng nếu thiếu mục này.

Changelog viết bằng tiếng Anh, theo thứ tự **Version**, **Release date**, **Major changes**, **Feature changes**, **Bug fixes**. Thay đổi chưa phát hành được ghi tạm trong **Unreleased**, với ngày phát hành **TBD**; khi phát hành mới chuyển sang phiên bản và ngày cụ thể.

Tạo bộ cài và tệp chạy bằng `npm run release:build`. Các tệp phát hành được đưa vào thư mục riêng `release/x.y.z/` ở thư mục gốc, với tên bắt đầu bằng `Collective-x.y.z`; ví dụ `release/0.2.0/Collective-0.2.0.exe`. Phiên bản dùng quy ước SemVer: tăng `x` cho thay đổi lớn toàn ứng dụng, tăng `y` cho tính năng mới, và tăng `z` cho sửa lỗi hoặc cải thiện hiệu năng. Cập nhật đồng bộ phiên bản trong `package.json`, `src-tauri/tauri.conf.json` và `src-tauri/Cargo.toml` trước mỗi lần phát hành.

### Yêu cầu hệ thống
Để chạy dự án ở môi trường phát triển, bạn cần chuẩn bị sẵn:
1. **Node.js 20.19+** và **NPM**; phiên bản dùng trong CI nằm trong `.nvmrc`.
2. **Rust** và **Cargo** (Cài đặt qua [rustup.rs](https://rustup.rs/)).
3. Cài đặt các công cụ biên dịch tương ứng với hệ điều hành của bạn (Xem chi tiết tại [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)).

### Các bước khởi chạy

1. **Clone project về máy tính:**
   ```bash
   git clone <repository-url>
   cd Collectives
   ```

2. **Cài đặt các gói phụ thuộc (Dependencies):**
   ```bash
   npm ci
   ```

   `prepare` đăng ký hook pre-push cho Git checkout này. Mỗi lần push sẽ chạy typecheck và lint; chỉ tiếp tục khi cả hai đạt. Để cài lại hook, chạy `npm run hooks:install`. Chạy `npm run test:hooks` để kiểm chứng hook bằng repo tạm và các fixture lỗi type/lint.

   Nếu đã có Git hooks riêng, tích hợp `node scripts/git/pre-push.mjs` vào hook pre-push hiện có; script cài đặt giữ nguyên cấu hình hook đó và báo hướng dẫn tích hợp.

   Policy bảo vệ `main` được lưu ở `.github/main-branch-protection.json`; `npm run check:ci-policy` kiểm tra policy khớp với các job trong workflow. Maintainer đã đăng nhập GitHub CLI có thể áp dụng bằng `gh api --method PUT repos/duktofn/Collectives/branches/main/protection --input .github/main-branch-protection.json`. Policy yêu cầu CI frontend, browser, smoke và backend trên Windows/Linux/macOS; nhánh phải cập nhật với main trước khi merge.

3. **Chạy ứng dụng trong chế độ phát triển (Development Mode):**
   ```bash
   npm run tauri dev
   ```
   Lệnh này sẽ khởi chạy Vite server cho frontend, biên dịch mã nguồn Rust ở backend và mở cửa sổ ứng dụng Collectives trên máy tính của bạn.

4. **Biên dịch ứng dụng bản Production (Release Build):**
   ```bash
   npm run release:build
   ```
   Sau khi hoàn tất, tệp chạy, bộ cài và `changelog.md` của phiên bản nằm trong thư mục `release/x.y.z/`. Các bộ cài gốc cũng nằm trong `src-tauri/target/release/bundle/`.

---

## Kiểm tra project

```bash
npm run typecheck
npm run lint
npm run test -- --run
npm run check:contracts
npx playwright install chromium
npm run test:e2e
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked --all-targets
```

Trên Windows, cần Visual Studio Build Tools với **Desktop development with C++** và Windows SDK để biên dịch backend. Rust riêng lẻ không cung cấp `link.exe`.

Có thể cài bộ công cụ này bằng PowerShell (chấp nhận hộp thoại UAC của Windows nếu xuất hiện):

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --override "--wait --quiet --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Sau khi cài hoàn tất, chạy lại `npm run tauri dev`.

Test thông thường tự tạo fixture, không yêu cầu dữ liệu báo cáo phase từ máy khác. Các lượt chụp giao diện lịch sử chạy riêng bằng `playwright.phase4.config.ts` và `playwright.phase5.config.ts`.

## 📝 Ví Dụ Sử Dụng Đặc Biệt

### 1. Khai báo Biểu đồ (Interactive Chart) trong ghi chú
Bạn có thể chèn một khối biểu đồ hình cột bằng cách viết cú pháp Markdown sau:

```chart
type: bar
data:
  labels: ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4"]
  datasets:
    - label: "Số Ghi Chú Đã Tạo"
      data: [15, 24, 40, 35]
      backgroundColor: "rgba(75, 192, 192, 0.5)"
      borderColor: "rgb(75, 192, 192)"
      borderWidth: 1
options:
  responsive: true
  plugins:
    title:
      display: true
      text: "Thống kê hiệu suất học tập"
```

Khi bạn di chuyển con trỏ ra ngoài khối này, CodeMirror sẽ tự động render nó thành một biểu đồ cột động cực đẹp nhờ Chart.js.

### 2. Cú pháp WikiLinks nâng cao
* Liên kết ghi chú cơ bản: `[[Kế hoạch năm 2026]]`
* Liên kết đến tiêu đề con: `[[Kế hoạch năm 2026#Mục tiêu quý 3]]`
* Liên kết đến đoạn văn cụ thể (Block Link): `[[Kế hoạch năm 2026#^b49a2d]]` (Với `^b49a2d` được định nghĩa ở cuối đoạn văn trong file đích).

---

## 📜 Giấy Phép (License)
Dự án được phân phối dưới giấy phép **MIT**. Xem file [LICENSE](LICENSE) để biết thêm thông tin chi tiết.
