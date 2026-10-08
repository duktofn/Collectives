# Sửa click code bị lệch dần — 2026-10-06

Phản hồi: ban đầu bình thường, sau khi click vào code block trong Write thì chuột bắt đầu nhận lệch. Ảnh kèm theo cũng cho thấy nút mở sidebar đặt nổi trên toolbar.

## Nguyên nhân và thay đổi

- Fence trước đây vẫn là dòng text CodeMirror nhưng bị ép `height`, `line-height`, `font-size` về 0 bằng CSS. Line decorations không có `heightRelevant` trong phiên bản CodeMirror đang cài, nên cách giấu đó không khai báo được phần thay đổi chiều cao cho height map.
- Giờ fence không hoạt động được thay bằng **block replacement từ StateField**, có widget với `estimatedHeight = 0`. Phần code vẫn là text CodeMirror bình thường; chọn block trong Write vẫn mở cả fence và tên ngôn ngữ để sửa.
- Dòng code dùng chiều cao dòng theo typography của editor. Bỏ padding dọc thay đổi khi chuyển first/last giữa body và fence, tránh thay đổi chiều cao những dòng body đã được đo.
- CodeMirror `posAtCoords` đo lại layout trước khi hit-test. Với một click code, adapter dùng caret DOM đang hiển thị và `posAtDOM` trước bước đo đó; vẫn để CodeMirror sở hữu thao tác chọn, kéo, Shift-click và nhiều con trỏ. Các click double/triple giữ hành vi mặc định.
- Nút mở sidebar chuyển vào luồng flex của header, dùng SVG menu và không còn tọa độ absolute hay padding bù riêng. Slot sidebar khi đóng không chiếm khoảng trống và không để các controls ẩn tham gia Tab.

## Kiểm chứng

- Test trên App thật với IPC mẫu và tài liệu 60 code block: mở/đóng nhiều block, cuộn từ đầu xuống cuối rồi quay lại, Source → Write, sidebar mở/đóng, font scale 1/1.3, device scale 1/1.5.
- 8 trường hợp browser qua; 6 trường hợp dài thực hiện tổng cộng 168 lần click có kiểm tra source position và nội dung không đổi. Hai trường hợp code ngắn kiểm tra lặp lại `Up / Down / Left / Right`, thêm 24 click.
- 6 regression code block qua: sửa ngôn ngữ, click, kéo chọn và Shift-selection qua nhiều block, Read, nhập delimiter.
- 20 kiểm tra unit shell/layout/editor qua. Lint, typecheck và build qua; cảnh báo kích thước bundle vẫn tồn tại.
- 10 kiểm tra browser workspace qua, gồm sidebar thu gọn, modal, search, rename và Settings.
- Computer Use đã quan sát cửa sổ Tauri đang chạy và click để xem vị trí caret, không nhập hoặc thay đổi nội dung ghi chú. Không coi việc quan sát đó là một phép đo tọa độ native tự động; các assertions định lượng ở trên chạy trong browser.

Tái chạy phép kiểm tra chính: `npx playwright test --config playwright.drift.config.ts` (cổng riêng 4181).

Ảnh fixture: `artifacts/code-drift/collapsed-true-font-1.png`, `collapsed-true-font-1.3.png`, `plain-code.png`. Các ảnh không sử dụng ghi chú cá nhân.
