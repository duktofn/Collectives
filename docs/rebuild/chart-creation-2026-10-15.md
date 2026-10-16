# Sửa luồng tạo chart — 2026-10-15

## Nguyên nhân đã tái hiện

- Trong menu Insert, `focusout` từ item đang có focus xảy ra trước khi item được click nhận `focusin`. Kiểm tra `activeElement` trong microtask đóng menu ngay giữa hai sự kiện, gỡ item Chart block trước `mouseup`/`click`. Lệnh chèn không được gọi.
- Slash completion không lọc theo phần lệnh đã gõ. Ngoài ra, khoảng chờ tương tác mặc định của autocomplete có thể bỏ qua Enter ngay khi gợi ý vừa hiện, làm chèn newline thay vì chart.
- Mẫu chart dùng dữ liệu rỗng nên chưa tạo biểu đồ có cột; con trỏ đặt trong YAML bị ẩn của widget.
- Lỗi YAML đồng bộ bị bỏ qua vì DOM widget chưa được gắn vào document trong `toDOM`, làm chart lỗi không có thông báo.

## Thay đổi

- Menu giữ nguyên khi focus chuyển giữa các item, vẫn đóng khi chuyển ra ngoài hoặc chọn một lệnh.
- `/chart` lọc đúng lệnh và nhận Enter khi gợi ý hiện. Mẫu chart có ba giá trị ví dụ và đặt con trỏ ngoài block để viết tiếp.
- Hiển thị lỗi YAML bằng alert và giữ đường sửa source/Apply. Chart có trạng thái loading/ready/error; kiểm tra chart thực tế qua instance Chart.js thay vì chỉ kiểm tra canvas tồn tại.
- Apply tìm range hiện tại của chart và chỉ thay phần YAML, giữ fence và văn bản xung quanh. Hỗ trợ fence bằng tilde hoặc bốn backtick; không nhận nhầm ngôn ngữ `charting`.
- Widget cập nhật khi syntax tree hoàn tất hoặc chế độ editor đổi; quyền sửa cập nhật đúng khi Read → Write. Giữ các tùy chọn chart, kể cả `animation: false`, và không áp kết quả tải bất đồng bộ cho widget đã hủy.

## Kiểm chứng

- TypeScript, ESLint, contract/boundary checks và frontend production build: qua.
- 46 file Vitest, 175 test: qua.
- Playwright sản phẩm: 46 test qua, gồm 9 regression chart mới. Phase 6: 5 test qua.
- Regression lệch dòng ở device scale 1/1.5: 18 lượt qua.
- Các test chart kiểm tra Insert, `/chart` + Enter, dữ liệu thực trong Chart.js, viết tiếp ngoài block, YAML lỗi rồi sửa, Apply với các loại fence, Read/Write, parse tài liệu dài, ngôn ngữ có tiền tố `chart`, và sửa sau khi chèn text phía trước chart.

Các test chart dùng note mẫu và IPC trong bộ nhớ. Backend không thay đổi trong patch này. Build vẫn có advisory về chunk trên 500 kB.
