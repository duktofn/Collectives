# Technical Design Document: Collection-based Markdown Note App

**Status**: Draft v1
**Working title**: chưa đặt tên chính thức

---

## 1. Tóm tắt

App ghi chú markdown, lấy cảm hứng từ Obsidian nhưng thay khái niệm **vault** (luôn gắn với 1 folder cố định) bằng **Collection** — tập hợp tham chiếu tới file/folder nằm rải rác ở bất kỳ vị trí nào trên máy, không bắt buộc chung 1 folder gốc. Local-first, không có yêu cầu sync giữa máy.

---

## 2. Bối cảnh & động lực

Mô hình vault truyền thống ép toàn bộ note phải nằm trong 1 cây folder duy nhất. Trong thực tế, note của một người thường rải rác: project nằm ở ổ này, ghi chú cá nhân ở ổ khác, tài liệu research ở một thư mục thứ ba — không có cách tổ chức nào ép được chúng về 1 folder mà không phải move file thật hoặc dùng symlink chữa cháy.

Collection giải quyết việc này bằng cách tách rời **tổ chức/hiển thị** (collection) khỏi **vị trí lưu trữ thật** (path trên disk). Một file vẫn nằm đúng vị trí cũ của nó; collection chỉ là một lớp tham chiếu/sắp xếp phía trên.

---

## 3. Mục tiêu & phạm vi

### Mục tiêu (v1)
- Collection tham chiếu file/folder ở path bất kỳ, không cần chung 1 folder.
- Lazy loading: không scan toàn bộ nội dung lúc mở collection.
- Import folder thật → collection, và export collection → 2 dạng (folder thật / package zip tự chứa nội dung).
- 3 trạng thái đọc/sửa: View, Edit-Source, Edit-Render.
- Hỗ trợ bảng, chart, deep-link tới block cụ thể, annotation hover.
- Theme/typography tuỳ biến toàn app, export/import được.
- Chạy native trên Windows và Linux.

### Ngoài phạm vi (v1)
- Sync dữ liệu giữa nhiều máy.
- Tự động phát hiện move/rename 100% khi file di chuyển xuyên ổ đĩa/ngoài phạm vi app biết.
- Chart builder kéo-thả (chỉ sửa qua spec dạng text).
- Theme riêng theo từng collection (đã quyết định theme là global toàn app).

---

## 4. Kiến trúc tổng thể

**Tech stack**: Tauri (Rust backend, system webview làm frontend — WebView2 trên Windows, WebKitGTK trên Linux) + CodeMirror 6 làm editor engine. Chi tiết & lý do chọn ở mục 14.

**Các thành phần chính**:

```
┌─────────────────────────────────────────────┐
│                  Frontend (Webview)           │
│  ┌───────────────┐  ┌──────────────────────┐ │
│  │ Editor Engine  │  │ Collection Tree UI   │ │
│  │ (CodeMirror 6  │  │ (virtualized render) │ │
│  │ + decorations) │  └──────────────────────┘ │
│  └───────────────┘  ┌──────────────────────┐ │
│                      │ Theme Engine (CSS vars)│ │
└──────────────────────┴──────────────────────┴─┘
                │ IPC (Tauri command)
┌─────────────────────────────────────────────┐
│                Backend (Rust)                  │
│ ┌────────────────┐ ┌─────────────────────┐   │
│ │ Collection      │ │ File System Layer    │   │
│ │ Manager         │ │ (watcher, file-id    │   │
│ │ (manifest CRUD) │ │  lookup, lazy read)  │   │
│ └────────────────┘ └─────────────────────┘   │
│ ┌────────────────┐ ┌─────────────────────┐   │
│ │ Link Index      │ │ Import/Export Module │   │
│ │ (global, wiki-  │ │ (folder ⇄ zip pkg)   │   │
│ │  link resolve)  │ └─────────────────────┘   │
│ └────────────────┘                              │
└─────────────────────────────────────────────┘
```

---

## 5. Data model — Collection manifest

Một collection = 1 file JSON, chỉ chứa metadata/tham chiếu, không chứa nội dung file thật.

```typescript
interface Collection {
  id: string;            // uuid
  schemaVersion: number; // bắt đầu từ 1, bump khi thay đổi structure
  name: string;          // phải unique toàn app (xem Invariant bên dưới)
  createdAt: string;     // ISO 8601
  updatedAt: string;
  entries: Entry[];
}

// id: application-level UUID, tách biệt khỏi OS-level file identity
// (inode / NTFS File ID). OS-level ID được look up runtime từ path khi
// cần detect move — không persist vào manifest.
type Entry =
  | { type: "file";       id: string; path: string }
  | { type: "folder-ref"; id: string; path: string }   // = sub-collection
  | { type: "group";      id: string; name: string; children: Entry[] };  // virtual folder
```

- **`file`**: tham chiếu 1 file rời, path bất kỳ.
- **`folder-ref`** (sub-collection): tham chiếu tới 1 folder thật. Manifest **không** enumerate nội dung — chỉ lưu path. Nội dung đọc live từ disk khi user expand node trên UI, đệ quy tự nhiên nếu có folder con.
- **`group`**: thư mục ảo, gom các `file` rời không có folder thật chung — chỉ tồn tại trong UI. Mỗi group có `id` (UUID) riêng để persist UI state (expand/collapse) và cho phép programmatic reference.

### Ví dụ

```json
{
  "id": "f3a1...",
  "schemaVersion": 1,
  "name": "Research Notes",
  "createdAt": "2026-06-20T10:00:00Z",
  "updatedAt": "2026-06-24T08:00:00Z",
  "entries": [
    { "type": "file", "id": "a1", "path": "C:/Users/A/idea.md" },
    { "type": "folder-ref", "id": "a2", "path": "D:/projects/notes" },
    { "type": "group", "id": "g1", "name": "Tạm gom", "children": [
      { "type": "file", "id": "a3", "path": "E:/x/random.md" }
    ]}
  ]
}
```

**Invariant — Collection name unique toàn app**: `name` của `Collection` phải unique (case-insensitive) trên toàn app. UI enforce tại thời điểm tạo mới và đổi tên — block + báo lỗi nếu trùng. Case-insensitive vì path trên Windows không phân biệt hoa/thường; nếu cho phép `"Research"` và `"research"` tồn tại song song, wikilink `[[Research/...]]` sẽ behave khác nhau trên Windows vs Linux. Đây là prerequisite của wikilink disambiguation (mục 11.1) — nếu invariant này không giữ được, qualified link format `[[CollectionName/...]]` không đủ để resolve duy nhất.

---

## 6. Lưu trữ

- `.collections/` nằm ở **app-data directory** (vd `~/.local/share/<app>/` trên Linux, `%APPDATA%/<app>/` trên Windows) — không nằm trong bất kỳ folder note nào, vì collection không có "nhà" tự nhiên như vault Obsidian (có `.obsidian` ngay trong vault).
- Mỗi collection = **1 file `.json` riêng** trong `.collections/`. Không dồn tất cả vào 1 file chung — tránh 1 lỗi write làm hỏng toàn bộ, dễ backup/share từng collection riêng.
- App settings (theme, font, scale...) = 1 file `settings.json` riêng, tách biệt hoàn toàn khỏi data collection.
- *Đề xuất, chưa confirm*: giữ 1–2 bản backup (`.bak`) mỗi lần write file collection — vì `.collections/` là single point of failure cho **cấu trúc tổ chức** (note thật vẫn an toàn ở vị trí gốc, chỉ mất công sắp xếp nếu folder này hỏng).

### Directory layout

```
<app-data>/
├── .collections/
│   ├── {uuid}.json          ← mỗi collection manifest, đặt tên theo collection id
│   └── ...
├── settings.json            ← app settings (theme, font, scale...)
└── link-index.db            ← global link index (xem mục 11.3)
```

- **Manifest filename** dùng UUID (`= id` trong manifest) thay vì name-based — tránh conflict khi rename collection, không có special character issue.
- **`settings.json`** nằm cùng cấp với `.collections/`, không lẫn vào bên trong folder đó.
- **`link-index.db`** cũng nằm cùng cấp — tách khỏi `.collections/` vì index là derived data, có thể rebuild từ manifests.

---

## 7. Lazy loading

- Mở collection → chỉ đọc manifest (nhẹ, vài KB).
- `folder-ref` chỉ đọc nội dung thật từ disk khi user expand node trên UI — không pre-scan toàn cây lúc mở collection.
- Tránh vấn đề "scan toàn vault lúc mở app" của các app kiểu vault truyền thống khi vault to.

---

## 8. File identity & theo dõi move/rename

Không có cách nào đảm bảo phát hiện 100%. 3 tầng, theo độ tin cậy giảm dần:

1. **Watcher event correlation** — chỉ bắt được khi cả path cũ và mới đều nằm trong phạm vi app đang watch.
2. **OS file-ID/inode lookup** — sống sót qua move/rename trong cùng volume/ổ đĩa, mất khi move sang ổ khác.
3. **Fallback thủ công** — UI relink, gợi ý bằng tên + hash gần đúng, cần user xác nhận trước khi relink.

→ Entry bị vỡ path phải hiển thị rõ trạng thái **"broken"**, không tự động xoá khỏi danh sách.

> **Lưu ý về `id`**: `id` trong manifest (mục 5) là application-level UUID, tách biệt khỏi OS-level file identity (inode trên Linux, NTFS File ID qua `GetFileInformationByHandle` trên Windows). OS-level ID được look up runtime từ `path` khi cần detect move — không persist vào manifest.

---

## 9. File watching & hiệu năng

*(Đã thống nhất hướng giải quyết, chưa thiết kế implementation chi tiết — để pass sau)*

- **File watcher**: chỉ watch entry đang visible/expanded trên UI, tránh chạm giới hạn watch của OS (vd `inotify` limit per-user trên Linux) khi `folder-ref` trỏ tới folder lớn.
- **Rendering**: virtualized tree cho `folder-ref` nhiều file — không render hết DOM một lần.
- **Hash**: tính on-demand lúc cần relink, không eager mỗi lần mở collection.
- **Search/index toàn collection**: dự kiến build tăng dần qua watcher event, không rescan toàn bộ mỗi lần search.
- **Startup validation**: Khi mở collection, chạy background pass kiểm tra `path` của mỗi entry trong manifest (chỉ `exists()`, không đọc nội dung). Entry không còn tồn tại ở path đó → mark "broken" ngay, không chờ user click. Pass này non-blocking — chạy sau khi tree UI đã render, không delay startup. Kết hợp với watcher activation sau khi UI ready. Ghi timestamp của lần validation cuối vào metadata để detect cần re-validate nếu app crash giữa chừng. Validation pass chạy parallel cho nhiều collections đang open.

---

## 10. Import / Export

### 10.1 Import folder thật → collection mới

Quét các con trực tiếp của folder: file → `file` entry, subfolder → `folder-ref` entry. Chỉ xử lý 1 cấp lúc import; đệ quy sâu hơn để `folder-ref` tự lazy-load khi mở sau. Feature này intentionally chỉ tạo `file` + `folder-ref` — không tạo `group` (vì folder thật không có khái niệm virtual group).

### 10.2 Export — 2 dạng

**Dạng 1 — Folder (materialize ngay lúc export)**: tạo folder mới. `file` → copy file; `folder-ref` → copy đệ quy toàn bộ folder thật; `group` → tạo subfolder thật chứa bản copy children. Một chiều, không sync ngược sau khi export. Import lại folder này dùng feature Import folder (mục 10.1) — round-trip sẽ mất `group` structure (group thành `folder-ref`), đây là by design vì folder export chỉ phục vụ "tạo bản copy plain", không yêu cầu restore exact structure.

**Dạng 2 — Package zip tự chứa nội dung** (1 file, portable, mở được cả khi không còn ở máy gốc):

```
collection-package.zip
├── manifest.json              # toàn bộ structure, có schemaVersion
└── assets/
    ├── <id-1>.md              # file entry: nội dung thật, đặt tên theo id
    ├── <id-2>/                # folder-ref entry: copy đệ quy toàn bộ folder
    │   ├── sub/
    │   └── ...
    └── ...
```

Chi tiết `manifest.json` trong zip:
- Giữ nguyên structure từ collection manifest gốc (`file`, `folder-ref`, `group` với đầy đủ `id`, `name`, `children`).
- Bao gồm `schemaVersion` để app version khác nhau có thể detect breaking change khi import.
- `path` field của mỗi entry trỏ tới vị trí tương đối trong `assets/` (vd `"assets/a1.md"`, `"assets/a2/"`) — không giữ path tuyệt đối từ máy gốc.
- `group` không có nội dung riêng trên disk — chỉ xuất hiện trong manifest để preserve structure. Children của group vẫn có `file`/`folder-ref` entries tương ứng trong `assets/`.

`manifest.json` map `id` → tên hiển thị gốc + vị trí trong structure. Đuôi file giữ `.zip` (không custom extension).

*Lifecycle*: nội dung chỉ được đọc tươi từ disk và nhúng vào `assets/` **tại đúng thời điểm bấm export**. Collection khi dùng bình thường trong app (mục 5–7) luôn chỉ lưu path tham chiếu, không bao giờ duplicate nội dung.

### 10.3 Import zip — code path riêng, không qua "Import folder"

Zip package đã có sẵn `manifest.json` với đầy đủ structure — đọc manifest trực tiếp, **không** đi qua feature "Import folder" (mục 10.1). Lý do: "Import folder" intentionally chỉ tạo `file` + `folder-ref` (không có `group`), còn zip import phải restore exact structure từ manifest.

**Flow**:
1. User chọn file `.zip` + chọn folder đích để extract.
2. Unzip toàn bộ `assets/` vào folder đích.
3. Đọc `manifest.json` → validate `schemaVersion` (reject nếu version cao hơn app hiểu được, offer hướng dẫn upgrade app).
4. Restore đúng `file` / `folder-ref` / `group` structure từ manifest.
5. Update `path` của mỗi `file` và `folder-ref` entry: thay relative path (`assets/...`) bằng absolute path thật tại folder đích sau extract.
6. Sinh `id` mới cho collection (tránh trùng với collection gốc nếu import trên cùng máy). Entry `id` bên trong giữ nguyên từ manifest.
7. Ghi collection manifest mới vào `.collections/`.

**Conflict resolution**: nếu folder đích đã tồn tại file/folder cùng tên với asset trong zip → hỏi user: overwrite / rename (thêm suffix) / skip. Không tự động overwrite.

---

## 11. Cross-collection linking

### 11.1 Wikilink (`[[Note Name]]`) & disambiguation

Cần global index toàn app (không chỉ trong 1 collection) map tên/id → path.

**Thuật toán resolve**:
1. Resolve ưu tiên trong collection đang mở trước. Nếu chỉ 1 match → resolve ngay, không hỏi.
2. Lúc tạo link mới: autocomplete khi gõ `[[` — nếu tên trùng ở nhiều collection, mỗi candidate hiện kèm tên collection chứa nó, buộc user chọn đúng ngay từ đầu.
3. Link được chọn → ghi dạng qualified vào text: `[[CollectionName/Note Name]]` thay vì chỉ `[[Note Name]]` — vẫn plain text thuần, không nhúng ID ẩn.
4. Link cũ bị ambiguous (gõ tay, hoặc phát sinh collision sau do thêm file mới): click vào → popup chọn đúng file, sau đó tự rewrite link thành dạng qualified — self-healing, lần sau không phải resolve lại.
5. **Rename collection**: Khi đổi tên collection, app offer "Cập nhật tất cả link `[[OldName/...]]` → `[[NewName/...]]`" — scan toàn bộ file thuộc **mọi collection đang open** (không chỉ collection bị rename, vì link `[[OldName/...]]` có thể nằm trong file thuộc collection khác). Nếu user từ chối, các link đó trở thành dangling (hiện như ambiguous link, bước 4 sẽ catch khi click). Không tự động rewrite mà không hỏi — chỉnh sửa file thật phải có user confirm.

### 11.2 Deep-link tới 1 dòng/đoạn cụ thể (block-reference)

So sánh 3 cách:

| Cách | Độ bền | Granularity |
|---|---|---|
| Line number `#L42` | Thấp — vỡ khi sửa nội dung phía trên | Dòng cụ thể |
| Heading `#Tên-heading` | Cao | Chỉ tới heading |
| **Block-reference `^block-id`** (chọn) | Cao, chỉ vỡ nếu xoá hẳn đoạn | Dòng/đoạn tuỳ ý |

Chèn ID ngắn vào cuối dòng/đoạn muốn link tới (`...nội dung. ^abc123`), link dạng `[[ten-file#^abc123]]`.

**Trade-off**: cách này chèn thêm ký tự vào file thật — khác với việc app chỉ "đọc" file gốc ở mọi nơi khác trong thiết kế. Không tránh được nếu muốn link bền tới đúng 1 dòng.

- **Render**: decoration ẩn marker ở Render/View mode, hiện nguyên ký tự ở Source mode.
- **Resolve khi click**: (1) resolve tên file → path qua global index, (2) mở file, scan tìm `^abc123` — chỉ scan 1 file lúc cần, không pre-index toàn app.
- **Tạo link**: bôi đen dòng/đoạn → "Copy link to this block" → sinh ID nếu chưa có, chèn `^id`, copy link vào clipboard. Tái dùng ID nếu đã có sẵn.

**Kết hợp qualified wikilink + block-reference / heading**: `[[CollectionName/Note Name#^abc123]]` hoặc `[[CollectionName/Note Name#Heading-name]]`. Resolve order: (1) lookup `CollectionName/Note Name` trong global index → path; (2) mở file, scan `^abc123` hoặc tìm heading tương ứng. Format đầy đủ: `[[<collectionName>/<noteName>#^<blockId>]]` hoặc `[[<collectionName>/<noteName>#<heading>]]`. Collection name có thể omit nếu unambiguous (resolve trong-collection trước, như quy tắc 11.1).

### 11.3 Link index — storage

Index lưu dưới dạng **SQLite database** (`link-index.db`) trong app-data directory (xem layout mục 6), tách khỏi `.collections/`. Lý do SQLite thay vì JSON file: atomic writes, không cần load toàn bộ vào memory, query đơn giản hơn khi index lớn.

**Rebuild strategy**:
- **Cold start** (DB chưa tồn tại hoặc bị corrupt): scan toàn bộ entries của tất cả collection đang open, build trong background — không block UI.
- **Warm start**: load từ DB, sau đó chạy diff với current manifest state (so sánh `updatedAt` timestamp) để catch up changes xảy ra khi app tắt. Kết hợp với startup validation (mục 9) — entries đã mark "broken" sẽ bị loại khỏi index.

**Schema tối thiểu**: map `displayName` → (`collectionId`, `entryId`, `path`, `entryType`). Không index nội dung file (nội dung thuộc search index riêng, mục 9). `entryType` (`file`/`folder-ref`) giúp phân biệt target khi resolve.

---

## 12. Editor & rendering

### 12.1 View / Edit mode

3 trạng thái: **View** (render, read-only) / **Edit-Source** (markdown thô, kiểu VSCode) / **Edit-Render** (WYSIWYG-ish, kiểu Obsidian Live Preview). Toggle View↔Edit, và trong Edit toggle Source↔Render.

**Kiến trúc**: 1 engine CodeMirror 6 duy nhất cho cả 3 trạng thái. Source/Render chỉ khác ở việc có áp decoration ẩn cú pháp markdown hay không; View = Render + `editable: false`. Tránh rủi ro convert AST↔markdown lossy nếu dùng 2 engine riêng (CodeMirror + ProseMirror/TipTap).

### 12.2 Bảng
Decoration nhận diện block table markdown → render widget table HTML thật (thêm/xoá dòng-cột), serialize ngược về cú pháp `| --- |` chuẩn.

### 12.3 Biểu đồ (tròn/đường/miền...)
Fenced code block với tag riêng, giống pattern Mermaid:

````
```chart
type: pie
data: [...]
```
````

Spec format: **YAML** (dễ đọc/sửa tay, không cần escape string đơn giản). Parser phía frontend dùng thư viện YAML standard (`js-yaml` hoặc tương đương).

Decoration thay block bằng chart thật (vd Chart.js) ở Render/View mode. v1 không làm chart builder kéo-thả — sửa qua spec trong code block, có thể click vào chart để hiện ô sửa spec ngay tại đó.

### 12.4 Annotation / chú thích hover

Bôi đen từ/đoạn, gắn chú thích — hover hiện tooltip nổi ngay tại đó.

**Format**: tái dùng cú pháp markdown footnote chuẩn, không tự chế:

```
Đây là một từ quan trọng[^note1].

[^note1]: Đây là chú thích bổ sung.
```

Dùng cú pháp chuẩn để graceful-degrade khi mở bằng app khác (hiện như footnote thường). Trong app này, decoration đổi cách render: gạch chân chấm dưới từ, hover hiện tooltip theo theme token.

**Tạo**: bôi đen → "Additional note" → sinh ID (tái dùng cơ chế gen-ID của block-reference), chèn `[^noteId]`, append định nghĩa xuống cuối file, đặt cursor để gõ nội dung. Edit-Render mode cho click vào tooltip để sửa inline, ghi lại vào dòng định nghĩa ở cuối file.

*Lưu ý*: annotation và block-reference dùng chung 1 pattern (chèn marker + quản lý content liên kết) — nên share logic gen-ID/quản lý marker.

---

## 13. Theming system

- Token hoá bằng CSS variables: `--font-body`, `--font-mono`, `--font-scale`, `--size-body`, `--size-h1`, `--size-h2`, `--size-h3`, `--size-h4` (đơn vị `em`, scale theo `--font-scale`), `--color-body`, `--color-h1`, `--color-h2`, `--color-h3`, `--color-h4`, `--color-code-bg`, `--color-code-text`, `--color-link`...
- 1 scale toàn cục ảnh hưởng tỉ lệ tất cả, vẫn override riêng được từng size.
- **Import font riêng**: copy file (`.ttf/.otf/.woff/.woff2`) vào app data dir (font là asset app, không phải content user — copy thay vì chỉ trỏ path). Hỗ trợ theo family (regular/bold/italic/bold-italic), đăng ký qua `@font-face`. Font mono tách riêng, import độc lập.
- Áp dụng live, không cần save/restart.
- **Scope: toàn app** (không phân biệt theo collection).
- **Export/import**: 1 file `theme.json`, font nhúng base64 ngay trong file (không tách file riêng) — đảm bảo "1 file = đủ để khôi phục y nguyên theme cũ".

---

## 14. Tech stack — quyết định cuối

**Chọn: Tauri** (Rust backend + system webview frontend).

| Lựa chọn | Lý do |
|---|---|
| **Tauri** ✅ | Nhẹ, ít RAM, ưu tiên hiệu năng (phù hợp với mức độ quan tâm tới watcher/lazy-load của project này) |
| Electron | Bundle Chromium cố định, render giống nhau mọi OS, nhưng nặng hơn — không chọn |
| Avalonia (.NET) | Bị loại: editor đã chốt CodeMirror 6 (web tech), dùng Avalonia vẫn phải nhúng WebView riêng để host CM6 — thêm 1 lớp phức tạp không cần thiết |

**Điều kiện đi kèm**: Tauri dùng WebView2 (Chromium) trên Windows nhưng WebKitGTK trên Linux — 2 engine khác nhau, **bắt buộc test riêng cả 2 OS**, không assume code chạy y hệt.

### OS-specific code bất kể stack
- File watcher: Linux có giới hạn `inotify` watch per-user; Windows có vấn đề buffer overflow khi đổi quá nhanh.
- File-ID lookup (mục 8): API khác hẳn — Linux dùng inode, Windows dùng NTFS File ID qua `GetFileInformationByHandle`.
- App-data directory: Windows `%APPDATA%`, Linux theo XDG spec — dùng lib abstract sẵn, không hardcode.

---

## 15. Rủi ro & việc còn mở

- Backup `.bak` cho `.collections/` — đề xuất, chưa confirm triển khai.
- Chi tiết implementation cho watcher scoping, virtualized rendering, incremental search index — đã thống nhất hướng, chưa thiết kế cụ thể (mục 9).
- Wikilink disambiguation (mục 11.1) — đã có thuật toán, chưa qua review thực tế khi build.
- OS file-ID/inode caching cho tier 2 của move detection (mục 8) — cần quyết định: in-memory (rebuild khi app start) hay persistent (phụ thuộc vào watcher scoping design ở mục 9).

---

## 16. Ngoài phạm vi / việc tương lai

- Sync collection giữa nhiều máy.
- Chart builder kéo-thả.
- Theme riêng theo từng collection.
- Tự động phát hiện move/rename xuyên ổ đĩa không watch.