# Báo cáo Đánh giá Codebase (Codebase Review Report)

Dưới đây là kết quả review toàn bộ codebase của dự án **Collection** (bao gồm cả phần Frontend SolidJS/CodeMirror và Backend Rust/Tauri/SQLite). Báo cáo tập trung vào việc phát hiện các bug tiềm ẩn (từ giao diện người dùng đến tầng thuật toán và lưu trữ dữ liệu) cùng hướng xử lý chi tiết.

---

## 1. Tổng quan các phát hiện
Hệ thống có cấu trúc tốt, phân tách rõ ràng giữa tầng dữ liệu Rust và giao diện người dùng SolidJS. Tuy nhiên, khi đi sâu vào chi tiết, chúng tôi phát hiện một số bug lớn liên quan đến:
- **Trải nghiệm Editor (CodeMirror 6):** Lỗi đóng khối code block làm biến mất nội dung file, lỗi mất focus khi sửa bảng (table), và crash editor khi gõ tiêu đề ở cuối trang.
- **Đồng bộ hóa Watcher (File/Folder Watcher):** Đồng bộ không đầy đủ khi thêm/xóa file, và lỗi bị xoá mất các theo dõi thư mục (folder watch) khi cập nhật collection.
- **Thuật toán kéo thả (Move Entry):** Lỗi lệch index (Index out of bounds) khi di chuyển các thư mục nằm trước nhóm mục tiêu trong cấu trúc cây.
- **Trình nhập ZIP (ZIP Conflict Resolution):** Lỗi tạo ra liên kết hỏng khi người dùng chọn bỏ qua (skip) ghi đè file có sẵn.

---

## 2. Danh sách Bug & Hướng khắc phục chi tiết

### Bug 1: Editor bị khóa / biến mất nội dung khi gõ khối code block chưa đóng
* **File:** [chart-widget.ts](file:///d:/Code/Collection/src/lib/cm-extensions/chart-widget.ts#L170-L199)
* **Triệu chứng:** Khi người dùng bắt đầu gõ khối code block của biểu đồ (ví dụ: ` ```chart `), toàn bộ văn bản phía sau khối này lập tức biến mất khỏi editor và hiển thị lỗi YAML hoặc chart. Do văn bản đã bị ẩn bởi Widget, người dùng không thể viết tiếp ký tự đóng ` ``` ` để khôi phục lại tài liệu.
* **Nguyên nhân:** Vòng lặp tìm kiếm dòng đóng ` ``` ` duyệt qua toàn bộ phần còn lại của file nếu không thấy dòng đóng. Sau đó nó vẫn tạo ra decoration thay thế `Decoration.replace` bao trùm từ vị trí bắt đầu đến hết file.
* **Hướng khắc phục:** Chỉ áp dụng decoration thay thế khi thực sự tìm thấy dòng đóng ` ``` `.
  ```typescript
  // src/lib/cm-extensions/chart-widget.ts (Line 175)
  let foundClosing = false;
  while (lastLineNum < doc.lines) {
    const nextLine = doc.line(lastLineNum + 1);
    const nextText = nextLine.text.trim();
    if (nextText === "```") {
      endPos = nextLine.to;
      lastLineNum++;
      foundClosing = true;
      break;
    } else {
      specLines.push(nextLine.text);
      endPos = nextLine.to;
      lastLineNum++;
    }
  }

  if (foundClosing) {
    const specYaml = specLines.join("\n");
    builder.add(
      startPos,
      endPos,
      Decoration.replace({
        widget: new ChartWidget(specYaml, startPos, endPos),
        block: true,
      })
    );
    i = lastLineNum + 1;
  } else {
    // Nếu chưa đóng block, bỏ qua không render widget và tiếp tục gõ bình thường
    i++;
  }
  ```

---

### Bug 2: Mất Focus khi di chuyển chuột/Tab giữa các ô trong Bảng (Table Widget)
* **File:** [table-widget.ts](file:///d:/Code/Collection/src/lib/cm-extensions/table-widget.ts#L65-L88)
* **Triệu chứng:** Khi sửa một ô trong bảng, sau đó bấm `Tab` hoặc click sang ô bên cạnh để sửa tiếp, con trỏ soạn thảo lập tức biến mất (mất focus). Người dùng buộc phải click đúp lại vào ô tiếp theo để sửa.
* **Nguyên nhân:** Khi ô hiện tại bị `blur`, sự kiện lưu thay đổi vào tài liệu được kích hoạt. Lệnh `view.dispatch` cập nhật document khiến CodeMirror vẽ lại các decorations. Do `TableWidget` không định nghĩa phương thức `updateDOM`, CodeMirror mặc định huỷ bỏ (destroy) toàn bộ cây DOM cũ của bảng và tạo lại mới tinh. Ô mà người dùng vừa click/tab sang đã bị huỷ hoại và thay bằng phần tử DOM mới, làm mất hoàn toàn trạng thái focus.
* **Hướng khắc phục:** Triển khai phương thức `updateDOM` trong class `TableWidget` để tái sử dụng DOM hiện tại nếu người dùng đang chỉnh sửa trực tiếp trên bảng.
  ```typescript
  // src/lib/cm-extensions/table-widget.ts
  class TableWidget extends WidgetType {
    // ...
    updateDOM(dom: HTMLElement, view: EditorView): boolean {
      // Nếu người dùng đang focus vào bất kỳ phần tử nào bên trong bảng này, giữ lại DOM cũ
      if (dom.contains(document.activeElement)) {
        return true;
      }
      return false; // Ngược lại tái tạo lại DOM bình thường
    }
  }
  ```

---

### Bug 3: File Watcher không khởi chạy cho các file mới thêm / sửa đổi
* **File:** [collections.ts](file:///d:/Code/Collection/src/stores/collections.ts)
* **Triệu chứng:** Khi người dùng thêm file mới vào collection (qua `addFiles`), hoặc xoá file, hoặc đổi tên file (relink), watcher ở backend không nhận biết được sự thay đổi của file mới đó khi có chỉnh sửa bên ngoài ứng dụng.
* **Nguyên nhân:** Hàm `watchActiveCollection()` thiết lập các watcher cho toàn bộ file trong collection hiện tại chỉ được gọi duy nhất khi `openCollection()`. Các hàm chỉnh sửa cấu trúc như `addFiles()`, `removeEntry()`, `relinkEntry()`, `importFolder()`, và `importZip()` hoàn toàn quên cập nhật lại danh sách watch của backend.
* **Hướng khắc phục:** Gọi `await this.watchActiveCollection();` sau khi chỉnh sửa danh sách file trong các hàm tương ứng của store:
  ```typescript
  // src/stores/collections.ts
  async addFiles(paths: string[]) {
    // ...
    await api.addFileEntries(activeId, paths);
    await this.reloadActiveCollection();
    await this.validateActiveCollection();
    await this.watchActiveCollection(); // Cập nhật watcher
  }
  // Áp dụng tương tự cho removeEntry, relinkEntry, importFolder, importZip
  ```

---

### Bug 4: Reset Watcher làm mất theo dõi các Folder Reference đang mở (Expanded Folders)
* **File:** [collections.ts](file:///d:/Code/Collection/src/stores/collections.ts#L224-L247) và [FolderRefNode.tsx](file:///d:/Code/Collection/src/components/tree/FolderRefNode.tsx)
* **Triệu chứng:** Khi người dùng mở rộng (expand) thư mục liên kết (Folder Reference), watcher giám sát sự thay đổi của thư mục đó hoạt động tốt. Tuy nhiên, sau đó nếu người dùng thực hiện bất kỳ hành động nào cập nhật collection (ví dụ thêm file), thư mục đang mở rộng lập tức mất khả năng tự động reload dữ liệu khi có thay đổi từ ổ đĩa.
* **Nguyên nhân:** Mỗi lần cập nhật danh sách file, `watchActiveCollection()` gọi `api.clearWatches()`, xoá hoàn toàn các watch trên cả file lẫn folder ở backend. Mặc dù folder reference trong UI vẫn đang ở trạng thái mở (`isExpanded`), nó không hề biết backend đã huỷ watch nên không đăng ký lại.
* **Hướng khắc phục:** Trong `watchActiveCollection()`, truy vấn `uiStore` để lấy danh sách các Folder Reference đang mở và đăng ký watch lại cho chúng sau khi clear.
  ```typescript
  // src/stores/collections.ts
  async watchActiveCollection() {
    const activeCol = this.activeCollection();
    if (!activeCol) return;
    try {
      await api.clearWatches();
      
      const recurse = async (entries: Entry[]) => {
        for (const entry of entries) {
          if (entry.type === "file") {
            await api.watchEntry(entry.path, entry.id);
          } else if (entry.type === "folder-ref") {
            // Nếu folder ref đang được expand trên UI, đăng ký watch lại
            if (uiStore.isExpanded(entry.id)) {
              await api.watchFolder(entry.path, entry.id);
            }
          } else if (entry.type === "group") {
            await recurse(entry.children);
          }
        }
      };
      await recurse(activeCol.entries);
    } catch (err) {
      console.error(err);
    }
  }
  ```

---

### Bug 5: Nhập file ZIP chọn "Skip" gây lỗi Broken Entry
* **File:** [archive.rs](file:///d:/Code/Collection/src-tauri/src/collection/archive.rs#L444-L450)
* **Triệu chứng:** Khi giải nén file ZIP để import collection, nếu có xung đột file và người dùng chọn "Bỏ qua" (Skip - không ghi đè), sau khi import xong, file đó trong collection hiển thị biểu tượng chấm đỏ báo hỏng (Broken Entry - File not found).
* **Nguyên nhân:** Khi xử lý tuỳ chọn xung đột là `skip`, hàm `extract_zip_assets` thực hiện lệnh `continue` để bỏ qua việc ghi đè file trên ổ đĩa. Tuy nhiên, đường dẫn lưu trong collection (`*path`) không được cập nhật từ đường dẫn ZIP nội bộ (`assets/xxx.md`) sang đường dẫn thật trên máy người dùng, làm đường dẫn bị trỏ sai.
* **Hướng khắc phục:** Cập nhật `*path` sang đường dẫn thực tế (`target_path`) trước khi `continue` trong cả hai khối xử lý `File` và `FolderRef`.
  ```rust
  // src-tauri/src/collection/archive.rs (Line 444)
  let resolution = resolutions.get(id).map(|s| s.as_str()).unwrap_or("overwrite");
  if resolution == "skip" {
      *path = target_path.to_string_lossy().to_string().replace('\\', "/");
      continue;
  }
  ```

---

### Bug 6: Lỗi lệch index (Index out of bounds / Đổi sai vị trí) khi di chuyển nhóm mục (Move Entry)
* **File:** [manager.rs](file:///d:/Code/Collection/src-tauri/src/collection/manager.rs#L188-L207)
* **Triệu chứng:** Khi người dùng kéo thả di chuyển một group hoặc file nằm ở vị trí đầu tiên (ví dụ index 0) vào trong một group khác nằm phía dưới (ví dụ index 1), thao tác thất bại với lỗi "Index out of bounds" hoặc mục bị nhảy sai vị trí.
* **Nguyên nhân:** Thuật toán ở backend thực hiện theo 2 bước: 
  1. Xóa phần tử cũ ra khỏi cây cấu trúc bằng `remove_entry_by_id_recursive`.
  2. Thêm lại phần tử đó vào parent mới dựa trên mảng chỉ số `new_parent_path` (được gửi từ client dựa trên cấu trúc cây trước khi xoá).
  Tuy nhiên, việc xóa phần tử ở bước 1 làm giảm kích thước của mảng cha cũ. Nếu phần tử bị xóa nằm trước bất kỳ chỉ mục nào trong đường dẫn `new_parent_path` của mục tiêu, chỉ mục đó của mục tiêu sẽ bị giảm đi 1 đơn vị. Lúc này `new_parent_path` cũ trở nên lỗi thời, dẫn tới trỏ sai hoặc lỗi biên mảng.
* **Hướng khắc phục:** Tìm đường dẫn gốc (`old_path`) của phần tử cần di chuyển trước. So sánh `old_path` với `new_parent_path`. Nếu chúng có chung một tiền tố và phần tử bị xoá làm ảnh hưởng đến chỉ số của `new_parent_path`, hãy trừ bớt chỉ mục tương ứng của `new_parent_path` đi 1.
  ```rust
  // Hướng giải quyết thuật toán trong move_entry_in_collection_path:
  // 1. Viết helper tìm old_path: Vec<usize> của entry_id cần chuyển.
  // 2. Kiểm tra nếu old_path là tiền tố của new_parent_path -> báo lỗi (di chuyển cha vào con).
  // 3. Nếu old_path.len() <= new_parent_path.len() và old_path[0..k] == new_parent_path[0..k]:
  //    nếu old_path[k] < new_parent_path[k] thì new_parent_path[k] -= 1;
  // 4. Tiến hành remove và insert với path đã được hiệu chỉnh.
  ```

---

### Bug 7: Không thể sửa liên kết Wikilink ở chế độ chỉnh sửa & Lỗi lưu Cache tĩnh
* **File:** [wikilink-decoration.ts](file:///d:/Code/Collection/src/lib/cm-extensions/wikilink-decoration.ts)
* **Triệu chứng:** 
  1. Khi người dùng click chuột vào một liên kết wikilink (dạng `[[Note Name]]`) để đặt con trỏ chỉnh sửa văn bản, editor lập tức chuyển trang và mở note đó, khiến người dùng không thể dùng chuột để sửa nội dung text của liên kết.
  2. Khi người dùng thêm note mới hoặc xoá đi, màu sắc liên kết không tự cập nhật (chữ đỏ hỏng vẫn đỏ, liên kết đúng vẫn đúng) cho tới khi khởi động lại app.
* **Nguyên nhân:** 
  1. Trình lắng nghe sự kiện `click` của wikilink kích hoạt trực tiếp việc chuyển trang mà không kiểm tra xem người dùng có nhấn phím bổ trợ (Ctrl/Cmd) hay không.
  2. Bộ lưu trữ cache trạng thái liên kết `wikilinkCache` là một map tĩnh `Map<string, boolean>` không bao giờ được làm sạch khi danh sách file của collection thay đổi.
* **Hướng khắc phục:**
  1. Chỉ chuyển trang khi click kèm phím `Ctrl` hoặc `Cmd` (Ctrl-click):
     ```typescript
     // src/lib/cm-extensions/wikilink-decoration.ts
     click(event, view) {
       const target = event.target as HTMLElement;
       if (!target.classList.contains("cm-wikilink")) return false;

       // Bắt buộc giữ phím Ctrl/Cmd để nhảy liên kết trong chế độ Edit
       const isEditable = !view.state.readOnly;
       if (isEditable && !event.ctrlKey && !event.metaKey) {
         return false;
       }
       // ... thực hiện chuyển trang
     }
     ```
  2. Cung cấp hàm làm sạch cache và gọi mỗi khi collection thay đổi:
     ```typescript
     export function clearWikilinkCache() {
       wikilinkCache.clear();
     }
     ```
     Gọi `clearWikilinkCache()` trong store `collectionsStore` tại các hàm `openCollection`, `addFiles`, `removeEntry`, `relinkEntry`, v.v.

---

### Bug 8: Crash editor khi chỉnh sửa tiêu đề ở dòng cuối cùng của tài liệu (RangeError)
* **File:** [render-decorations.ts](file:///d:/Code/Collection/src/lib/cm-extensions/render-decorations.ts#L97-L107)
* **Triệu chứng:** Editor đột ngột crash với lỗi màn hình đỏ hoặc lỗi console `RangeError: Invalid position` khi người dùng gõ tiêu đề (ví dụ `# `) ở dòng cuối cùng của file.
* **Nguyên nhân:** Khi ẩn biểu tượng tiêu đề (`#`), mã nguồn trang trí sử dụng `to: nodeTo + 1` để nuốt luôn ký tự khoảng trắng phía sau dấu `#`. Tuy nhiên, nếu tiêu đề nằm ở cuối file và không có ký tự tiếp theo, `nodeTo + 1` vượt quá độ dài tài liệu (`doc.length`), khiến CodeMirror ném ra ngoại lệ vị trí không hợp lệ.
* **Hướng khắc phục:** Sử dụng hàm `Math.min` để giới hạn biên của decoration luôn nằm trong giới hạn độ dài tài liệu:
  ```typescript
  // src/lib/cm-extensions/render-decorations.ts (Line 100)
  if (!isCursorInLine) {
    const maxTo = Math.min(nodeTo + 1, view.state.doc.length);
    decs.push({
      from: nodeFrom,
      to: maxTo,
      value: Decoration.replace({
        widget: new EmptyWidget(),
      }),
    });
  }
  ```

---

### Bug 9: SolidJS Reactive Props bị mất phản ứng trong các Dialog
* **File:** [ZipConflictDialog.tsx](file:///d:/Code/Collection/src/components/common/ZipConflictDialog.tsx) và [ThemePanel.tsx](file:///d:/Code/Collection/src/components/theme/ThemePanel.tsx)
* **Triệu chứng:** Khi người dùng click nút đóng hoặc nút hủy trong dialog, dialog không đóng lại hoặc xảy ra cảnh báo lint của SolidJS.
* **Nguyên nhân:** Lỗi cơ bản trong SolidJS: Khi bind prop callback trực tiếp vào sự kiện click của thẻ HTML tự nhiên (`onClick={props.onClose}`), compiler SolidJS chỉ đánh giá biểu thức này một lần lúc khởi tạo phần tử DOM. Nếu callback `props.onClose` bị thay đổi từ cha, sự kiện click không được cập nhật.
* **Hướng khắc phục:** Luôn bao bọc prop callback trong một hàm mũi tên để duy trì tính phản ứng:
  ```tsx
  // Sửa từ:
  onClick={props.onClose}
  // Thành:
  onClick={() => props.onClose()}
  ```

---

## 3. Kiến nghị Cải tiến Kiến trúc & Tối ưu hóa Code
Ngoài các lỗi chức năng trên, chúng tôi đề xuất một số cải tiến chất lượng mã nguồn:

1. **Sử dụng Transaction API của Rusqlite:**
   Thay vì thực thi các câu lệnh chuỗi thô `"BEGIN TRANSACTION"` và `"COMMIT"`, nên sử dụng API transaction chính thức của rusqlite: `let tx = conn.transaction()?;`. Điều này giúp tự động `ROLLBACK` khi có lỗi xảy ra sớm giữa chừng thông qua cơ chế Drop của Rust, tránh kẹt khóa database.
2. **Hỗ trợ tìm kiếm Substring trong Wikilink Autocomplete:**
   Hiện tại autocomplete sử dụng `like_query = format!("{}%", query);` khiến việc gõ chữ ở giữa tên file không gợi ý đúng. Thay đổi thành `%{}%` để tăng trải nghiệm tìm kiếm của người dùng.
3. **Chuẩn hóa đường dẫn tập tin (Path Normalization):**
   Tại môi trường Windows, Tauri dialog trả về đường dẫn chứa dấu `\`, trong khi đó các file JSON manifest và link index lưu dưới dạng `/`. Nên xây dựng một bộ tiện ích chuyển đổi đồng bộ mọi đường dẫn đầu vào/đầu ra thành dạng `/` để tránh lỗi lệch đường dẫn khi so sánh chuỗi trên Windows.
