# Write — vị trí click sau khi block đổi chiều cao

## Lỗi tái hiện

Khi một block nằm phía trên vùng đang xem đổi chiều cao, CodeMirror có thể còn một lượt đo layout chờ animation frame. Xử lý chuột mặc định gọi `posAtCoords`, chạy lượt đo đó ngay lập tức và điều chỉnh scroll anchor. Tọa độ của sự kiện vẫn thuộc hình ảnh trước khi cuộn, nên có thể được ánh xạ sang một dòng khác.

Regression tái hiện bằng block có thể đổi kích thước: click vào vị trí source 1903 nhưng nhận 1973 trước patch. Adapter cũ chỉ xử lý code block, nên không bảo vệ đoạn văn và các block khác. Click đôi/ba lần cũng rơi về đường ánh xạ mặc định và tái hiện cùng lỗi.

## Sửa ở lớp editor chung

- `pointer-selection.ts` dùng caret DOM của chữ đang hiển thị rồi đổi sang vị trí source bằng `posAtDOM`, trước khi một lượt đo layout có thể dịch viewport. Áp dụng cho text trong toàn bộ Write.
- Click đơn, chọn nhóm ký tự bằng click đôi và chọn dòng bằng click ba lần dùng cùng vị trí đã bắt. Giữ mapping qua document changes, kéo chọn, Shift và nhiều vùng chọn trong vòng đời mouse selection của CodeMirror. Tách nhóm theo grapheme và character category của editor.
- Bỏ qua các control và editor con để textarea của chart và ô bảng tiếp tục sở hữu focus/input.
- `editor-layout.ts` theo dõi kích thước các block DOM đang được render bằng ResizeObserver. MutationObserver cập nhật các phần tử được theo dõi khi CodeMirror thay viewport; sự kiện font tải xong cũng yêu cầu đo lại.
- Không phụ thuộc class của code/chart/table. Widget mới dùng block decoration chuẩn có thể thay đổi chiều cao DOM và được theo dõi tự động. Không quét toàn tài liệu trên mỗi phím gõ; observer được tháo khi editor bị hủy.
- Extension chung được đăng ký trong base editor; code block giữ phần hiển thị fence và khóa hình học khi kéo chọn.

## Kiểm chứng

- TypeScript, lint, contract/boundary checks và production frontend build: qua.
- 46 file Vitest, 175 test: qua.
- Playwright mặc định: 37 test qua, gồm 5 regression mới. Phase 6: 5 test qua.
- `playwright.drift.config.ts`: 18 lượt qua ở device scale 1 và 1.5, với font scale 1/1.3, sidebar mở/đóng và cuộn qua tài liệu 60 code block.
- Regression block độc lập kiểm tra click đơn/đôi/ba trong lúc còn lượt đo chờ, sau đó thay chiều cao mà widget không gọi `requestMeasure` và xác nhận height map tự cập nhật.
- Regression chart/bảng thực hiện nhiều vòng mở/đóng source chart, focus textarea, sửa ô/thêm hàng, click đoạn văn rồi nhập ký tự và kiểm tra đúng vị trí source. Các regression kéo chọn, Shift-selection, Undo bảng, Source/Write và Read vẫn qua.

Các assertions tọa độ chạy trong Chromium; không dùng chúng để tuyên bố đã đo riêng native WebView2. Backend không thay đổi trong patch này. Build vẫn có advisory về chunk trên 500 kB.

Chạy lại: `npx playwright test --config playwright.drift.config.ts` hoặc `npm run test:e2e`.
