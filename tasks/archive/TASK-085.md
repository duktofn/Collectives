## TASK-085 — Lưu quy tắc commit theo từng task

**State:** Done
**Current Step:** Step 2 — Complete

### Description
Lưu yêu cầu mới của người dùng: commit task hiện tại và tự commit theo từng task từ nay, trước khi chuyển sang task tiếp theo.

### Scope
- AGENTS.md
- codebase.md (ghi chú về AGENTS.md được track)
- task.md; tasks/archive/TASK-085.md

### Requirements
- [x] Chính sách repository yêu cầu commit theo task, có task ID và checks thực tế.
- [x] AGENTS.md và entry task được commit riêng; không gộp các task Pending khác.

### Steps
- [x] Step 1 — Lưu chính sách → verify: đọc lại AGENTS.md.
- [x] Step 2 — Kiểm tra staged scope và commit → verify: git show đúng phạm vi; hash trong Commit log.

### Handoff
- Branch: main
- Base commit: 7e8fbed
- Uncommitted files: tài liệu plan cũ chưa commit; task này chỉ cập nhật chính sách và entry riêng.
- Next action: Triển khai TASK-007 sau commit chính sách.
- Blockers: none.

### Verification
Đã đọc lại quy tắc trong AGENTS.md, xác nhận commit theo task và ghi checks/hash. Chỉ stage AGENTS.md và entry TASK-085; nội dung staged được kiểm tra trước khi commit. Hash lưu ở task.md → Commit log.

### Log
- 2026-10-18 — Tạo task trước khi lưu quy tắc mới. TASK-006 đã commit riêng ở 7e8fbed.
- 2026-10-18 — Đã lưu quy tắc; AGENTS.md được đưa vào version control để chính sách đi cùng codebase. Không đưa các task Pending khác vào commit này.
