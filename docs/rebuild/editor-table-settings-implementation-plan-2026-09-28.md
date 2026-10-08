# Plan: nhập Markdown, bảng và Settings Apply/Cancel

Trạng thái: đã triển khai trong workspace. Typecheck, lint, production build, focused Chromium interactions, `cargo check`, và Rust library tests đã qua. Smoke test WebView2 chưa thể chạy trong phiên này vì không có cửa sổ native khả dụng.

## 1. Hành vi cần đạt

### Nhập ký tự

- Gõ `*`, `"`, `'` tạo cặp và đặt caret ở giữa, áp dụng cho editor Markdown và ô bảng đang sửa.
- Gõ dấu đóng trước dấu đóng có sẵn sẽ đi qua nó; bọc được nội dung đang chọn.
- Gõ hai dấu `*` liên tiếp tạo cặp bold `**|**`; hoàn tất nội dung rồi gõ dấu đóng không sinh thêm cặp ngoài ý muốn.
- Không ghép cặp khi paste/IME composition; xử lý ký tự escape và dấu nháy trong từ như `don't` để không tạo nháy dư.
- Giữ hành vi hiện có của wikilink `[[`, code fence, undo/redo và các dấu ngoặc khác.

### Hiển thị và sửa bảng

- Ô bình thường hiển thị inline code, italic, bold và các tổ hợp lồng nhau.
- Focus ô chuyển sang Markdown gốc để sửa; rời ô trở lại nội dung đã render.
- Nội dung Markdown là nguồn dữ liệu chính. Không lấy textContent của bản render để ghi đè source, vì sẽ mất dấu định dạng.
- Tab/Shift+Tab chuyển ô; Enter kết thúc sửa ô một dòng; Escape hủy bản sửa ô hiện tại. Ctrl/Cmd+S phải lấy cả bản sửa ô đang focus.
- Điều hướng sang file khác hoặc đóng editor phải đưa bản sửa ô vào cơ chế lưu hiện có, không phụ thuộc riêng vào sự kiện blur.
- Hàng đang hover/focus: nhóm `+ / −` ở mép trái. `+` chèn ngay bên dưới hàng đó; `−` xóa đúng hàng đó.
- Cột đang hover/focus: nhóm `+ / −` ở cả mép trên và mép dưới. Hai nhóm cùng thao tác trên một cột: `+` chèn bên phải, `−` xóa cột đang chọn.
- Header có nút thêm hàng đầu tiên nhưng không xóa header. Cho phép xóa hết hàng dữ liệu; giữ tối thiểu một cột để bảng còn hợp lệ.
- Thay các nút `+ Row / + Col` toàn cục bằng điều khiển theo hàng/cột. Nút vẫn hiện khi con trỏ chuyển từ ô sang nút và có thể dùng bằng bàn phím.
- View/read-only không có thao tác sửa, thêm hoặc xóa.

### Settings

- Mở cửa sổ: tạo bản nháp độc lập từ settings đã Apply gần nhất.
- Đổi màu, font, kích thước, theme mode, visibility, Reset hoặc import theme chỉ thay đổi bản nháp. Giao diện app và settings trên disk chưa đổi.
- Footer cố định có **Apply** và **Cancel**. Apply chỉ bật khi có thay đổi hợp lệ và không đang lưu.
- Apply lưu thành công rồi mới cập nhật app; cửa sổ vẫn mở, trạng thái vừa lưu trở thành mốc mới.
- Cancel, nút X, Escape, click backdrop và đóng cửa sổ settings theo đường khác đều bỏ bản nháp rồi đóng, không hỏi xác nhận thêm.
- Sau Apply, nếu sửa tiếp rồi Cancel thì giữ lần Apply gần nhất.
- Lưu thất bại: giữ cửa sổ và bản nháp, hiện lỗi có thể thử lại; app vẫn dùng settings trước đó.
- Trong thời gian commit Apply, khóa form và đóng cửa sổ để tránh hiển thị Cancel sau khi commit đã bắt đầu. Trạng thái đang lưu phải rõ ràng và không bị kẹt nếu lỗi.

## 2. Hiện trạng và điểm cần sửa

- `delimiter-pairs.ts` đã ghép cặp nháy đơn/đôi trong CodeMirror nhưng chưa có `*`. Ô bảng là contenteditable riêng nên không đi qua input handler này.
- `table-widget.ts` dùng textContent, split theo mọi dấu `|`, và dựng lại bảng khi blur. Điều này làm lộ Markdown, dễ tách sai escaped pipe, mất căn lề khi serialize và có nguy cơ dùng offset cũ sau khi tài liệu đổi.
- Bảng đang được nhận dạng bằng quét từng dòng, có thể nhận nhầm bảng nằm trong code fence. Chuyển ownership sang node Table của parser.
- `ThemePanel.tsx` gọi cập nhật app, áp theme và save trên từng lần đổi. Reset, import theme, thêm/xóa font có các đường tác động trực tiếp riêng.
- `FileVisibilityPreference.tsx` ghi ngay vào UI store/localStorage, nằm ngoài Settings hiện tại.
- Backend `save_settings_to_path` đang ghi trực tiếp bằng fs::write; cần commit file an toàn để hỗ trợ Apply rõ ràng.

## 3. Các bước triển khai

Bổ sung ưu tiên: sửa interaction code block trước phần bảng theo [plan code block](./code-block-interaction-plan-2026-09-28.md). Click, arrow keys và drag selection cần được xác minh bằng geometry thật trên WebView2 trước khi mở rộng interaction của bảng.

### Bước A — Settings draft và Apply/Cancel

1. Tạo session settings sở hữu baseline, draft, dirty, validation, trạng thái applying và lỗi. UI chỉ sửa draft.
2. Chuyển toàn bộ form, Reset và import theme sang draft; mọi đường đóng gọi chung discardAndClose.
3. Đưa hideUnsupportedFiles vào settings đã lưu để Apply có một nơi lưu chính. Migration đọc lựa chọn localStorage cũ khi trường mới chưa có; không ghi đè lựa chọn người dùng đã lưu theo schema mới.
4. Font import chỉ ghi nhận nguồn và metadata trong draft. Font delete chỉ đánh dấu xóa; không xóa file đang được sử dụng trước Apply.
5. Apply validate, chuẩn bị font mới với tên không đè file cũ, ghi settings qua file tạm và atomic replacement phù hợp Windows, rồi cập nhật state/theme/font registry một lần. File font không còn dùng được dọn sau commit; lỗi dọn file không biến một lần Apply thành công thành thất bại.
6. Nếu chuẩn bị hoặc lưu thất bại, giữ settings cũ và dọn file tạm của lần Apply đó. Kết quả async của dialog import đã bị Cancel không được cập nhật phiên mở mới.
7. Export theme xuất settings đã Apply; không vô tình xuất bản nháp chưa áp dụng.

Phạm vi: ThemePanel, SettingsWorkflow, FileVisibilityPreference, UI store, theme engine, settings API/Rust DTO và settings persistence. Giữ tương thích settings cũ; đồng bộ IPC nếu thêm command/payload.

### Bước B — Parser/model bảng và render ô

1. Bật Table extension trên Markdown parser; lấy table ranges từ syntax tree, loại code fence/HTML block theo parser thay vì nhận dạng bằng regex toàn tài liệu.
2. Tách model bảng, parsing/serialization và thao tác hàng/cột khỏi DOM widget. Giữ escaped pipe, ô trống, số cột và căn trái/giữa/phải.
3. Render inline bằng AST và các DOM element an toàn như code/em/strong. Nội dung HTML trong ô không được thực thi.
4. Quản lý source draft của ô riêng khỏi DOM preview. Hoàn tất thay đổi ô trước hành động cấu trúc, save, đổi tài liệu hoặc đóng editor; mỗi thao tác cấu trúc là một transaction undo được.
5. Map range qua transaction và kiểm tra widget hiện tại trước khi ghi; không sử dụng from/to cũ từ callback của DOM tái sử dụng.

### Bước C — Điều khiển hàng/cột

1. Giữ chỉ số ô active từ hover hoặc focus; định vị ba nhóm nút ở mép hàng và hai đầu cột bằng geometry của ô.
2. Hover chỉ cập nhật vị trí/visibility nhóm nút, không parse lại Markdown hoặc dựng lại bảng.
3. Khi click, giữ source đang sửa, thêm/xóa tại vị trí xác định và chuyển focus đến ô hợp lệ gần nhất.
4. Xử lý cột cuối, hàng cuối, header, scroll ngang, resize, zoom và pointer chuyển từ ô sang nút.
5. Nút có accessible label theo hàng/cột, trạng thái disabled rõ ràng và focus bàn phím nhìn thấy được.

### Bước D — Ghép cặp dùng chung

1. Tách quyết định ghép cặp thành logic thuần dùng cho CodeMirror và ô bảng.
2. Thêm star pairing, overtype và bước chuyển italic sang bold; bảo toàn selection và lịch sử undo.
3. Adapter contenteditable sử dụng beforeinput/selection, bỏ qua composition và paste; không chặn sự kiện input của toàn editor.

### Bước E — Kiểm chứng và bàn giao

- Settings: sửa rồi Apply; sửa rồi Cancel/X/Escape/backdrop; Apply rồi sửa và Cancel; mở lại; lỗi lưu; Apply liên tiếp; async import trả về sau khi đóng; thêm/xóa font rồi Cancel; migration visibility.
- Bảng: định dạng lồng nhau; code có dấu pipe; escaped pipe; alignment; ô trống; source không đổi khi chỉ focus/blur; không render bảng trong code sample; chỉnh ô rồi thêm/xóa/save; undo/redo; file switch; read-only.
- Điều khiển: chèn/xóa đúng hàng/cột ở đầu/giữa/cuối; hai nhóm nút cột đồng nhất; hover không mất nút; giữ focus sau thao tác; viewport hẹp và bảng cuộn ngang.
- Ghép cặp: dấu đơn/đôi, `*`/`**`, selection, overtype, escape, apostrophe, IME, paste và wikilink.
- Chạy tests tập trung, typecheck, lint, build và cargo check khi sửa Rust. Kiểm tra trực tiếp trên WebView2 cho contenteditable, caret, hover và đường đóng settings.
- So sánh trước/sau trên cùng fixture: không có IPC save hay editor remeasure khi chỉ sửa draft settings; hover bảng không phát sinh doc transaction; Apply chỉ kích hoạt một lần áp theme và yêu cầu đo lại editor.

## 4. Thứ tự commit đề xuất

1. Settings session + Apply/Cancel, persistence và font/visibility transaction.
2. Table parser/model + inline render + lifecycle sửa ô.
3. Table hover controls + ghép cặp dùng chung.

Mỗi commit kèm kiểm chứng đúng phạm vi. Chưa commit/push hoặc triển khai các bước này trong lượt lập plan.
