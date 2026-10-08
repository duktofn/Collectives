# Plan sửa selection, undo/redo, inline code và controls bảng

Trạng thái: đã triển khai. Selection được vẽ trên nền code với alpha theo theme; history được giữ qua đổi mode và reset theo document session; cell draft có undo/redo, caret mapping và Escape discard; empty table cells giữ đúng cột; inline code có style theme; controls nằm trong gutter với vị trí neo theo shell/viewport.

Kiểm chứng: `npm run typecheck`, `npm run lint`, `npm run build`, 15 targeted Vitest tests và 12 Chromium interaction tests đã qua. Screenshot fixtures kiểm tra selection khi focus/blur, selection qua prose/code, gutter, inline code và cuộn ngang. Smoke test WebView2 chưa chạy được trong phiên này vì không có cửa sổ native khả dụng.

## 1. Selection code block có dữ liệu nhưng không nhìn thấy

Quan sát từ code: drawSelection đã được bật; .cm-codeblock-line có nền đặc. Khả năng lớp nền dòng che lớp .cm-selectionLayer cần được xác nhận bằng computed style và screenshot, không kết luận chỉ từ selection state.

Thực hiện:
- Dựng fixture chọn một phần dòng, nhiều dòng và qua ranh giới prose/code; kiểm tra cả native selection lẫn selection do CodeMirror vẽ, focused và unfocused.
- Kiểm tra stacking context, z-index, opacity, CSS ::selection và background của code line. Sửa cách xếp lớp/nền theo cơ chế CodeMirror để vùng chọn nằm trên nền và dưới chữ; không tăng z-index tùy ý làm che caret hoặc toolbar.
- Kiểm tra fence bị thu chiều cao về 0 không tạo vùng bôi đen sai vị trí, không tính badge/trang trí vào selection.
- Dùng màu selection theo theme, đảm bảo vẫn đọc được code và syntax highlight trên dark/light/custom theme.

Nghiệm thu: selection nhìn thấy đúng phạm vi khi kéo chuột, Shift+Arrow và Ctrl+A, kể cả cuộn ngang; nội dung copy khớp text đã chọn. Kiểm tra trực tiếp bằng screenshot/browser/WebView2, không chỉ assert anchor/head.

## 2. Ctrl+Z / Ctrl+Y trong chế độ render

Quan sát từ code: history và historyKeymap đã có. Ô bảng dùng contenteditable riêng; handleCellKeydown hiện chỉ xử lý Enter/Escape/Tab. updateDOM giữ nguyên ô đang sửa khi refresh, có nguy cơ document đã undo nhưng text ô vẫn cũ. Editor cũng reconfigure base extensions khi đổi mode; cần xác minh history có thực sự bị mất hay lỗi chỉ ở focus/command routing.

Thực hiện:
- Tái hiện và ghi nhận doc/history trước-sau theo ma trận: prose, code block, ô bảng đang sửa, nút bảng đang focus; gõ, ghép cặp, paste, thêm/xóa hàng/cột và đổi mode.
- Duy trì một lịch sử CodeMirror cho mỗi document session. Không tạo lịch sử thứ hai từ browser contenteditable; không reset history chỉ vì đổi source/edit-render. Không cho undo đi sang file khác.
- Route Ctrl/Cmd+Z, Ctrl+Y và Ctrl/Cmd+Shift+Z từ ô bảng/control về đúng editor. Chặn native undo khi đã xử lý để không thực thi hai lần.
- Gắn source transaction của ô bảng với selection/caret tương ứng. Khi undo/redo, đồng bộ lại cả source lẫn DOM ô đang focus và caret; không bỏ qua active cell như khi chỉ refresh những ô khác.
- Chốt transaction grouping: gõ liên tục nhóm hợp lý; paste, ghép cặp và từng thao tác thêm/xóa hàng/cột có undo rõ ràng. Escape hủy sửa ô không gây nhánh redo khó hiểu hoặc làm draft DOM khác tài liệu.
- Sau undo/redo, dirty state và autosave phải phản ánh nội dung mới.

Quy tắc mode: undo/redo thay đổi nội dung trong edit-render và edit-source. View chỉ đọc vẫn không sửa tài liệu; history được giữ để dùng khi quay lại chế độ chỉnh sửa. Xác minh mode thực tế của lỗi bằng facet/state thay vì chỉ dựa vào tên Render trên UI.

Nghiệm thu: gõ → undo → redo đúng nội dung, caret và dirty state ở prose/code/table; thêm/xóa bảng có thể khôi phục; đổi mode không mất history; không sửa file khác hoặc read-only view.

## 3. Inline code trong bảng chưa có diện mạo code

Quan sát từ code: table-model nhận InlineCode và table-widget đã sinh thẻ code. Ảnh cho thấy một số text đã là monospace; cần phân biệt thiếu style với lỗi parser trước khi sửa.

Thực hiện:
- Kiểm tra source → AST → DOM → computed style trên ô lỗi. Phân biệt một cặp backtick, delimiter nhiều backtick và backtick literal nằm trong nội dung code.
- Bổ sung style có scope trong bảng: font mono, màu chữ/nền code theo theme, padding và bo góc nhẹ; áp dụng cho cả header/body và tổ hợp với bold/italic.
- Không thay đổi Markdown source chỉ để render. Khi focus sửa ô, hiển thị source theo quy tắc hiện tại; blur trở lại inline code đã render.
- Nếu parser/model sai, sửa nhận diện delimiter và ánh xạ source/display theo quy tắc Markdown, giữ escaped pipe, khoảng trắng và ký tự đặc biệt. Không dùng regex thay thế HTML hoặc innerHTML từ dữ liệu người dùng.

Nghiệm thu: code trong bảng có hình thức nhất quán với inline code ngoài bảng, không lộ delimiter ở preview; focus/blur/undo không mất dấu backtick; code nhiều backtick, pipe và bold/italic xung quanh vẫn đúng.

## 4. Đưa các nút + / − ra ngoài bảng

Quan sát từ code: row controls nằm left: 0 ở shell chưa dành khoảng trống bên trái. Column controls lấy top/bottom của ô đang hover nên có thể xuất hiện đè giữa các hàng.

Thực hiện:
- Tách outer shell chứa controls và inner scroll container chứa bảng. Dành gutter bên trái và phía trên/dưới đủ cho nút, không đặt nút trong diện tích cell.
- Hàng: neo nhóm nút ngoài mép trái toàn bảng, căn giữa theo hàng active.
- Cột: lấy tâm ngang cột active, nhưng neo nhóm trên phía trên toàn bảng và nhóm dưới phía dưới toàn bảng; không lấy mép trên/dưới ô body đang hover.
- Dùng chung hệ tọa độ shell/scroll. Cập nhật khi scroll ngang, resize, đổi font, thay đổi hàng/cột; ẩn controls của cột ngoài vùng nhìn thấy thay vì đè lên cột khác.
- Giữ active target khi pointer đi qua gutter tới nút hoặc nút nhận keyboard focus. Không để pointermove làm đổi target trong lúc click.
- Hover/focus chỉ cập nhật controls cần thiết và không thay đổi kích thước layout, parse lại tài liệu hay ghi source.
- Giữ chức năng: + hàng chèn dưới, + cột chèn phải; − xóa đúng target; header/cột cuối có bảo vệ; read-only không có controls chỉnh sửa.

Nghiệm thu: bounding box các nút không giao với vùng cell; nội dung không bị che như ảnh; nút vẫn bấm được ở viewport hẹp, khi cuộn ngang, ở hàng/cột đầu/cuối và bằng bàn phím. Chèn/xóa đúng target, undo/redo đúng.

## 5. Thứ tự triển khai và kiểm chứng

1. Fixture + baseline tái hiện cả bốn lỗi trên browser thật; giữ riêng kết quả edit-render và read-only view.
2. Selection layer và history/DOM synchronization trước, vì ảnh hưởng tính đúng của thao tác sửa/copy.
3. Style/parse inline code và bố trí gutter/controls ngoài bảng.
4. Regression tập trung cho selection visual, keyboard history, table round-trip, control geometry; typecheck, lint, build; smoke WebView2.

Không dùng test mock tọa độ hoặc build pass để kết luận selection và controls hiển thị đúng. Chỉ mở rộng refactor nếu baseline chứng minh cần; không quay lại renderer thay cả thân code bằng widget.

Phạm vi chính: Editor.css, Editor.tsx, markdown-mode.ts, table-widget.ts, table-model.ts, các fixture và e2e editor hiện có. Chỉ sửa code-block-widget.ts khi bằng chứng chỉ ra fence/decoration geometry có liên quan.
