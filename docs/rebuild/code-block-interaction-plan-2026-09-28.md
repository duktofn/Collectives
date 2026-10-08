# Plan sửa click, arrow keys và selection trong code block

Trạng thái: đã triển khai renderer dựa trên dòng source và kiểm chứng click/keyboard/drag bằng browser Chromium trên geometry thật. Typecheck, lint và production build đã qua. Smoke test WebView2 chưa thể chạy trong phiên này vì không có cửa sổ native khả dụng.

## 1. Phát hiện từ code hiện tại

- Toàn bộ FencedCode bị thay bằng Decoration.replace với block widget. CodeMirror không còn các dòng text hiển thị tương ứng để xử lý caret và vertical movement thông thường.
- Widget chặn mousedown mặc định rồi dispatch selection. Trong edit-render, dispatch này có thể thay ngay widget bằng source; DOM và geometry dùng cho drag không còn ổn định.
- mouseleave gọi stopDrag nên kéo ra khỏi khung bị cắt. Listener trên document không có vòng đời cleanup trong destroy của widget.
- Click và keyboard dùng hai đường ánh xạ tọa độ riêng. Fallback theo defaultCharacterWidth không phản ánh tab, font thực tế, Unicode hay cuộn ngang.
- Keyboard bridge chỉ chạy ở edit-render và bỏ qua selection không rỗng, nên không xử lý đủ read-only view và Shift+Arrow liên tiếp.
- Highlight bất đồng bộ thay innerHTML của code có thể làm mất native DOM selection nếu đang chọn chữ; cần xác nhận bằng tái hiện browser.
- Test hiện tại mock posAtCoords/coordsAtPos, có test dispatch tiếp lên DOM cũ. Chúng không chứng minh được click/drag đúng trên DOM đang hiển thị.

Đây là kết luận từ đọc code; cần tái hiện thực tế để xác định đóng góp của từng nguyên nhân trong lỗi người dùng gặp.

## 2. Hành vi đích

- Click đặt caret đúng dòng và ký tự được bấm, kể cả sau cuộn ngang, đổi font hoặc zoom.
- ArrowUp/Down đi lần lượt qua dòng code, giữ cột mong muốn khi gặp dòng ngắn rồi dòng dài; không bỏ qua block.
- ArrowLeft/Right, Home/End và Shift kết hợp các phím này có hành vi nhất quán với editor.
- Kéo chọn liên tục trong block và qua ranh giới code/prose; kéo ngược, Shift-click và double-click chọn từ hoạt động.
- Có thể kéo ra khỏi khung để mở rộng selection và tự cuộn. Nhả chuột hoặc hủy pointer kết thúc đúng gesture.
- Vùng bôi đen khớp với text được copy; không lẫn badge ngôn ngữ, DOM trang trí hoặc fence ẩn khi chỉ chọn thân code.
- Edit-render cho phép sửa; view chỉ cho điều hướng, chọn và copy, không thay đổi nội dung. Edit-source giữ hành vi source thông thường.
- Thao tác click/selection không làm block nhảy chiều cao hoặc khiến caret lệch vì chuyển representation giữa gesture.

## 3. Hướng kiến trúc ưu tiên

Giữ thân code là các dòng text thật do CodeMirror sở hữu trong cả edit-render và view. Render bằng line/mark decorations và syntax highlighting của CodeMirror; chỉ trang trí hoặc ẩn các marker fence riêng.

- Một EditorState.selection là nguồn selection chính; caret, drag, keyboard và copy cùng dựa trên vị trí tài liệu.
- Không thay toàn thân code bằng một block widget và không đặt atomic range lên thân code.
- Badge chỉ là trang trí, không nhận pointer hoặc tham gia text selection.
- Không tự chuyển toàn block thành source khi mousedown. Source đầy đủ vẫn có ở edit-source; quy tắc sửa delimiter trong edit-render được kiểm chứng ở prototype.
- Dùng language support/lazy loading hiện có cho highlight; tránh innerHTML thay thế text nodes trong lúc chọn.
- Chọn một scroll container nhất quán cho dòng code dài. Xác minh scroll ngang, clipping và caret trước khi chốt CSS; không tạo một scroller riêng trên từng dòng.

Prototype là cổng quyết định: phải chứng minh ẩn fence, geometry, selection xuyên block và hiệu năng hoạt động trước khi thay renderer chính. Nếu có giới hạn CodeMirror không đáp ứng, ghi nhận cụ thể rồi điều chỉnh thiết kế; không ghép thêm các phép đo cột theo chiều rộng ký tự trung bình.

## 4. Các bước triển khai

### A. Tái hiện và dựng baseline tương tác thật

1. Tạo fixture gồm prose trước/sau, hai code block liên tiếp, dòng rỗng, dòng rất dài, tab, tiếng Việt và emoji.
2. Tái hiện riêng edit-render và view trên browser Chromium và WebView2 của app.
3. Ghi vị trí bấm, selection anchor/head, dòng/cột, scroll offset, mode và DOM còn kết nối hay không tại lúc lỗi.
4. Bổ sung regression sử dụng tọa độ DOM thật; giữ unit test chỉ cho logic không phụ thuộc layout.

### B. Prototype renderer dựa trên dòng source

1. Tách xác định range fence/body/language khỏi widget; lấy marker từ syntax tree, không mặc định dòng cuối luôn là closing fence.
2. Giữ body text trong CodeMirror, áp nền, font mono, highlight và góc bo qua decorations.
3. Kiểm chứng fence ẩn không tạo hàng trống bất thường, không làm vertical movement mắc kẹt; code fence chưa đóng phải giữ đủ dòng cuối.
4. Giữ chart widget có ownership riêng để thay đổi code block không làm hỏng chart.
5. Kiểm chứng padding, line height và horizontal overflow với theme/font đang hỗ trợ.

### C. Hợp nhất interaction và bỏ workaround

1. Dùng cơ chế pointer/selection/vertical movement mặc định của CodeMirror trên body text.
2. Bỏ handler chặn mousedown, caretRangeFromPoint bridge, fallback cột và arrow key interception riêng khi prototype đã chứng minh không cần.
3. Nếu còn handler cần thiết, đặt lifecycle ở view plugin, cleanup đầy đủ và không dừng gesture chỉ vì mouseleave.
4. Đảm bảo read-only view có thể nhận focus/keyboard selection nhưng chặn mọi thay đổi tài liệu.
5. Kiểm tra kéo chọn khi highlight tải xong, khi scroll tự động, khi đổi mode/file hoặc cửa sổ mất focus.

### D. Kiểm chứng hiệu năng và bàn giao

- Map/cache structural ranges theo transaction; selection-only không quét lại toàn bộ syntax tree hoặc highlight lại toàn document.
- Tôn trọng viewport/virtualization của CodeMirror; so sánh số DOM nodes, chi phí di chuyển caret và render với tài liệu nhiều block trước/sau.
- Chạy các test tương tác mục A, editor regression liên quan, typecheck, lint và build.
- Chạy smoke trực tiếp trên WebView2; kết quả jsdom mock hoặc build pass không thay thế kiểm tra geometry thực tế.

## 5. Tiêu chí nghiệm thu

1. Click đầu/giữa/cuối dòng, dòng rỗng và sau tab/emoji vào đúng vị trí quan sát được.
2. ArrowUp/Down đi vào/ra cả hai đầu block và qua hai block liên tiếp, không skip; Shift+Arrow mở rộng selection nhiều lần liên tục.
3. Kéo chọn từ prose vào code, từ code ra prose và xuyên nhiều block không mất anchor hoặc dừng giữa chừng.
4. Text copy khớp chính xác phạm vi source được chọn; double-click chọn đúng từ; Home/End không nhảy sai block.
5. Các trường hợp trên vẫn đúng khi cuộn ngang, zoom, đổi font/line height và khi grammar highlight tải muộn.
6. View không làm dirty document; edit-render sửa/undo/redo đúng; không làm mất newline, code cuối file hoặc code fence chưa đóng.
7. Không xuất hiện lại backtick/fence thừa ở chế độ xem, không có listener tồn tại sau khi editor bị destroy.

## 6. Chia commit dự kiến

1. Fixture và regression browser tái hiện click/drag/keyboard hiện tại.
2. Code block renderer dựa trên source lines + hợp nhất interaction.
3. Hoàn thiện geometry, read-only, performance và xác nhận WebView2.

Chưa commit/push hoặc triển khai các bước trong lượt lập plan này.
