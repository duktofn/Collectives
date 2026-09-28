# Collectives — rà soát kiến trúc và kế hoạch refactor

Ngày: 2026-09-26. Phạm vi: working tree hiện tại, ưu tiên hiệu năng và tính đúng đắn của editor/save. Hai ảnh đính kèm là bằng chứng triệu chứng, không phải chỉ dẫn kiến trúc Unity. Kế hoạch ban đầu và trạng thái triển khai được ghi ở cuối tài liệu; các thay đổi có sẵn của người dùng vẫn được giữ nguyên.

## 1. Kết luận

Giữ SolidJS + CodeMirror 6 + Tauri/Rust + SQLite. Chưa có bằng chứng cần đổi framework hay viết lại toàn bộ app. Nút thắt nằm ở lượng công việc mỗi lần gõ, ranh giới phiên tài liệu, giao thức save/watcher và việc dựng lại collection sau delta nhỏ.

Ưu tiên thực hiện: **save correctness → render correctness → editor hot path → watcher/collection → startup**. An toàn dữ liệu là điều kiện bắt buộc khi tối ưu save.

## 2. Kiến trúc hiện tại

```text
App / workflows / components
  ├─ stores/editor.ts: phiên tài liệu, queue save, conflict, navigation
  ├─ stores/collections.ts: collection CRUD, watcher, cache, reconciliation
  └─ CodeMirror extensions: code, chart, table, link, block-ref
          ↓ features/*/application.ts → infrastructure/ipc.ts
          ↓ shared/ipc: typed commands + events
Rust ipc/commands → application/services → repository ports
  ├─ documents.rs: decode, token, atomic replacement
  ├─ metadata/: SQLite metadata + link repository
  └─ fs_layer/watcher.rs: bounded queue, filesystem feed + legacy events
```

Điểm tốt: IPC có contract, repository ports cho phép test độc lập, token nội dung bảo vệ save, thay file có cơ chế giữ bản cũ, watcher có sequence/epoch và giới hạn queue, metadata có normalized cache và reconciliation.

Điểm cần chỉnh: application phía frontend nhiều nơi chỉ re-export IPC; điều phối nghiệp vụ vẫn tập trung trong singleton stores. Collection store gọi editor và extension; wikilink extension lại import collection/editor stores. Vòng phụ thuộc này khiến cache, lifecycle và sự kiện khó kiểm soát. Backend `application/services.rs` gom nhiều use case khác nhau. Tách module chỉ có ích khi chuyển được quyền sở hữu state và công việc, không chỉ di chuyển file.

## 3. Bugs và rủi ro đã tìm thấy

### B1 — P1: dấu fence còn hiện ngoài code block

- Nguồn: `src/lib/cm-extensions/code-block-widget.ts`, `buildCodeBlockDecorations`, khoảng dòng 209–240; `render-decorations.ts` không có nhánh ẩn `CodeMark`.
- Widget chỉ replace `innerFrom..innerTo`, nên dòng mở và đóng fence vẫn nằm ngoài widget. Probe với `Before\n\n```text\nhello\n```\nAfter` xác nhận range replacement chỉ là `hello`. Khớp trực tiếp ảnh đầu tiên.
- Extension code block không đọc mode facet: ngay cả `view`, selection nằm trong block vẫn chuyển thành source lines. Cần tách quy tắc view và live-edit.
- CSS `Editor.css:499` dùng `pre-wrap` + `break-word`; đây là nguyên nhân dòng cây thư mục bị bẻ dòng. Chưa đo được overflow hình học trong WebView; không đánh đồng việc xuống dòng với tràn container.
- Hướng sửa: view che toàn bộ fence; live-edit mở source khi selection tương tác block, che fence khi preview. Giữ source mapping, copy/select và height measurement. Code mặc định giữ dòng, scroll ngang trong block, có tùy chọn wrap.
- Regression: fence ba/bốn backtick, tilde, indent, block rỗng/chưa đóng, tài liệu bắt đầu bằng code, selection vào/ra, resize, copy, theme/font.

### B2 — P1: own-save có thể tạo conflict giả và banner không thoát được

- Nguồn: `src/stores/collections.ts:96` và các legacy listeners; `src/stores/editor.ts:150`, `drainSaveQueue`, `saveFile`.
- Mọi filesystem event cùng path trong lúc dirty đều có thể bị xem là external change. Document write không cung cấp mutation ID/token cho watcher reconciliation.
- Tái hiện bằng mock: write đang chạy → watcher callback → write/read thành công. Kết quả `isDirty=false` nhưng `error=external_change_conflict`. Retry gọi saveFile rồi return ngay vì không dirty; banner còn nguyên.
- Chuỗi chữ trong ảnh thứ hai khớp thông báo frontend tại `applyFilesystemConflict`, không phải message backend khi token mismatch. Vì vậy ảnh chưa chứng minh write thực sự thất bại; có thể là conflict thật hoặc conflict giả.
- Sửa bằng commit receipt + đối chiếu token sự kiện/current disk với token đã commit. Không bỏ qua toàn bộ watcher trong vài giây: có thể che mất thay đổi bên ngoài thật.

### B3 — P1: write rồi read lại có thể nhận nhầm external version

- Nguồn: `src/stores/editor.ts:88–118`; write IPC trả `void`.
- Lịch chạy: app ghi A → chương trình ngoài ghi B → app readFile nhận B/token-B. Store ghi `openFileContent=A`, nhận token-B và đánh dấu clean, không so nội dung readback. Lần save tiếp theo dùng token-B có thể ghi đè B mà không conflict.
- Probe xác nhận store nhận token bên ngoài và dùng token đó ở lần ghi tiếp theo. Đây là tái hiện logic bằng mock, chưa phải stress test filesystem thật.
- Sửa: write trả `{versionToken, mutationId, persistedRevision}` gắn với chính bytes được commit. Không dùng readback tách rời để chứng nhận save; nếu có readback thì mismatch phải chuyển conflict.

### B4 — P1: conflict thật thiếu đường phục hồi giữ cả hai phiên bản

- Nguồn: `src/stores/editor.ts` snapshot expectedToken và catch/requeue; `Editor.tsx` error banner; `repositories/documents.rs:309`.
- Nếu disk đã đổi, Retry gửi lại token cũ nên vẫn bị từ chối. Close cũng thử save nên không đóng được khi conflict còn đó. Reload là lựa chọn duy nhất trên banner để thoát nhưng bỏ draft.
- Cần state conflict có base/local/disk; có Save copy, Compare/Merge và Reload. Nếu cho ghi đè, phải là lựa chọn rõ ràng của người dùng và CAS trên version disk vừa xem. Không tự cập nhật expectedToken rồi retry mù.

### B5 — P1 cần regression: lịch sử Undo có thể đi xuyên tài liệu

- Nguồn: `src/components/editor/Editor.tsx`, effect đổi generation/openFileContent thay toàn bộ doc bằng transaction; `markdown-mode.ts` giữ history extension.
- Không có reset EditorState/history khi đổi file, không loại transaction load khỏi history. Nếu cùng EditorView được tái sử dụng, Ctrl+Z trên B có thể phục hồi nội dung A rồi autosave vào B.
- Đây là rủi ro từ code, chưa tái hiện UI trong lượt này. Thêm test A → sửa/save → mở B → Undo trước khi chỉnh sửa. Thiết kế session mới bằng EditorState mới hoặc cache riêng mỗi document, cấm history xuyên file.

### B6 — P2: code block và widget con có thể parse chồng lấn

- Nguồn: `table-widget.ts` quét mọi dòng tìm bảng; `chart-widget.ts:223` tìm chuỗi `startsWith("```chart")`; code block dùng syntax tree riêng.
- Không loại bảng nằm trong fenced code; chart prefix còn nhận cả `charting`. Các replacement có thể chồng nhau hoặc diễn giải ví dụ Markdown thành widget.
- Sửa: dùng cùng syntax tree và quyền sở hữu block; chỉ tạo table/chart từ đúng node ngữ cảnh. Test fenced example, nested list/quote, chart prefix không hợp lệ.

### B7 — P2: DOM code widget giữ source offset cũ

- Nguồn: `code-block-widget.ts`, `toDOM` và `updateDOM`.
- `eq` phân biệt offset nhưng `updateDOM` trả true và chỉ cập nhật HTML/badge. `data-source-*` và closures mousedown vẫn giữ instance cũ. Chèn nội dung trước block có thể làm click/drag clamp theo range cũ.
- Sửa bằng binding dữ liệu hiện hành vào DOM/controller, hoặc tái tạo DOM khi source range đổi. Xác nhận bằng test click sau insert trước block; chưa đo pointer thật trong lượt này.

### B8 — P2: các lỗi save phụ và giới hạn đọc

- `Editor.tsx` autosave timer/Ctrl+S gọi promise save không catch: rejection ngoài luồng dù store đã giữ error. Đưa save scheduling/error handling về session service.
- `documents.rs` đọc toàn bộ bytes rồi mới kiểm tra 10 MiB. File rất lớn vẫn tốn bộ nhớ trước khi bị từ chối. Dùng metadata làm preflight và bounded read để chống file tăng kích thước trong lúc đọc.
- Hai lần kiểm token trước replace giảm nhưng không loại race với writer ngoài giữa check và replace. Per-path queue chỉ tuần tự hóa writer nội bộ; không được quảng cáo như CAS nguyên tử với mọi chương trình ngoài.
- Replace thành công nhưng cleanup backup thất bại hiện trả lỗi; UI không biết dữ liệu đã commit. Receipt cần phân biệt committed-with-warning và not-committed.

## 4. Điểm nghẽn hiệu năng

| Ưu tiên | Bằng chứng trong code | Thay đổi đề xuất |
|---|---|---|
| Cao | `Editor.tsx` updateListener gọi `doc.toString()` mỗi docChanged, store giữ chuỗi và so dirty | Giữ CodeMirror Text/snapshot bất biến trong session, revision rẻ; serialize lúc save/export, xử lý clean checkpoint/undo về bản đã lưu |
| Cao | Code field rebuild toàn syntax tree mỗi selection; table/chart quét toàn doc mỗi edit; render plugin thêm một lượt quét tree tìm active link | Map decorations qua changes, invalidate block bị ảnh hưởng; selection chỉ cập nhật block trước/sau; dùng resolve tại cursor cho active link |
| Cao | `documents.rs` save đọc file cho original_bytes, decode, token đầu, token trước replace; frontend lại read toàn file | Bỏ readback nhờ commit receipt; tái sử dụng initial bytes cho decode/hash, giữ kiểm tra cuối cần thiết |
| Trung bình/cao | `metadataCache.ts:114` rebuild children, sort và dò ancestors cho mọi entry; materialize toàn tree sau delta | Update touched entries/parents, structural sharing; cycle check vào đường reparent. Hiện worst case ancestor walk có thể O(N²) với tree sâu |
| Trung bình/cao | `watcher.rs:214` recv_timeout rồi try_recv ngay; chưa chờ đủ cửa sổ gom batch; legacy + v2 cùng tồn tại | Gom theo deadline/max count, coalesce cùng path, một consumer chịu trách nhiệm reload; đo duplicate event trước khi bỏ legacy |
| Trung bình | Group/FolderRef render `<For>` toàn children mở; collection delta gọi lại watchActiveCollection | Virtualize danh sách visible rows sau benchmark; watch-set diff thay đăng ký lại theo mỗi delta |
| Trung bình | Chart.js/registerables và nhiều highlight languages import eager; unknown-language auto detect có thể thử nhiều grammar | Lazy chart/highlight, chỉ grammar cần dùng, cache bounded theo language+content; giới hạn highlight block lớn |

Không áp dụng viewport-only ViewPlugin cho block replacement một cách máy móc: decoration thay chiều cao cần cơ chế trực tiếp phù hợp CodeMirror. Giữ structural ranges trong StateField, tách chi phí parse/highlight/DOM để tối ưu từng phần.

Build hiện tại: chunk JS lớn nhất **1,141.05 kB**, gzip **376.71 kB**, CSS **51.48 kB**. Đây là kích thước asset, không phải số đo startup hay RSS. Những chunk language đã được tách không có nghĩa toàn bộ đều tải lúc startup.

## 5. Kiến trúc đích

- `DocumentSession`: sở hữu doc/revision/base token/dirty/history; độc lập UI và collection store.
- `SaveCoordinator`: một write in-flight mỗi document, coalesce pending revision mới nhất, barrier cho switch/close, commit receipt, conflict state và draft recovery.
- `FilesystemReconciler`: một nơi xử lý sequence/epoch, self-write, rename, external version và reload; bỏ reload trùng giữa nhiều listeners.
- `MarkdownBlockIndex`: syntax tree chung cho code/table/chart, incremental invalidation. Rendering nhận callbacks/facets thay import stores.
- `CollectionRepository` phía frontend: normalized authoritative state; selector theo entry/parent, projection chỉ tại chỗ cần compatibility.
- Rust chia `DocumentService`, `CollectionService`, `ArchiveService`; blocking filesystem work chạy qua cơ chế executor có giới hạn sau khi kiểm tra thread behavior thực tế. Không chỉ đổi sync thành async mà vẫn gọi blocking I/O trên cùng executor.
- Typed error union thay chuỗi dùng chung; UI phân biệt saving, saved, conflict, retryable failure, committed warning.

## 6. Kế hoạch triển khai theo PR

### PR 0 — Baseline và regression harness

1. Tách unit/integration tests tự dựng fixture khỏi kiểm tra artifact theo ngày cũ.
2. Thêm regression B1–B7; test filesystem Windows thật cho self-save/external edit/atomic replacement.
3. Đo release WebView2 với tài liệu 100 KiB, 1 MiB, 10 MiB; 100/1k code blocks; collection 1k/10k entries; event burst 1k/10k. Ghi cấu hình máy, WebView version và fixture seed.
4. Đo input-to-paint p50/p95, long tasks, save-to-commit, queue depth, event-to-visible, cold/warm open, heap/RSS, số parse/full reads.

Đầu ra: baseline tái chạy được, tests lỗi đỏ trước patch. Không dùng thời gian chạy Vitest làm latency UI.

### PR 1 — Save protocol và conflict recovery

1. Thay write result bằng receipt; cập nhật contract, DTO, adapter, ports và generated artifacts cùng một PR.
2. Serialize write theo canonical document identity; queue chỉ giữ bản pending mới nhất, không lưu mọi intermediate snapshot. Close/switch chờ revision barrier.
3. Reconcile watcher theo receipt/token; không nuốt external change. Khi conflict, ngừng auto-retry cho đến hành động giải quyết.
4. Thêm Save copy, compare/merge; draft recovery độc lập bản gốc nếu cần khôi phục sau crash.

Acceptance: 0 false conflicts trong 1.000 lần own-save; không ghi đè external edit trong các lịch xen kẽ có kiểm soát; latest draft còn nguyên khi write/read/cleanup thất bại; retry phản ánh trạng thái thật. Không bỏ fsync/check để đạt số đo đẹp.

### PR 2 — Render đúng và session isolation

1. Fix fence range, mode-aware source reveal, wrapping option và DOM offset lifecycle.
2. Tạo parser/block ownership chung, loại table/chart trong code sample.
3. Tách session/history khi đổi file, giữ selection/scroll theo từng session nếu cần.

Acceptance: không hiện fence ở view; source round-trip không đổi bytes do chỉ đổi mode; Undo không đi xuyên file; copy/drag và scroll không nhảy qua block. Visual test ở viewport hẹp/rộng và các font đang hỗ trợ.

### PR 3 — Editor incremental hot path

1. Chuyển content authority sang document session, tránh toString trên từng phím.
2. Incremental block index + map decorations, cache highlight có giới hạn, bỏ full-tree scan khi cursor chỉ di chuyển trong cùng block.
3. Lazy chart/highlight với placeholder có kích thước ổn định; thêm degraded mode cho tài liệu/block lớn.

Acceptance đề xuất, cần chốt theo PR 0: p95 input-to-paint ≤50 ms với fixture 1 MiB trên máy chuẩn; cải thiện ít nhất 30% nếu baseline vượt ngưỡng; thao tác gõ thường không tạo long task >50 ms; memory không tăng liên tục sau 100 lần mở/đóng.

### PR 4 — Watcher và collection incremental

1. Coalesce event theo path và deadline; một đường reconciliation, epoch-aware buffering khi đang snapshot.
2. Update normalized entries và touched parents; giữ object identity cho entry không đổi, cache link invalidation theo phạm vi.
3. Watch-set diff; virtualized visible rows với keyboard/focus accessibility.

Acceptance: sửa một entry không rebuild cả collection; không mất event qua overflow/reconcile/collection switch; p95 event-to-visible ≤500 ms cho burst chuẩn, có backpressure và queue bounded. Đây là budget đề xuất, chưa phải kết quả hiện tại.

### PR 5 — Startup và ranh giới module

1. Lazy load các tính năng nặng theo đo bundle/startup; tránh import cycle giữa editor extensions và stores.
2. Chia services/store theo ownership ở mục 5; xóa compatibility path khi test chứng minh không còn consumer.
3. Khóa CI bằng relative performance budgets trên runner ổn định; fixture correctness và native release smoke test.

Acceptance: initial JS giảm tối thiểu 25% so với baseline nếu các module nặng nằm trên startup path; cold start không regression; không đổi framework chỉ vì kích thước bundle.

Mỗi PR giữ một capability rollback rõ ràng. Với IPC, cập nhật frontend/backend đồng bộ; không cho fallback từ receipt protocol sang blind write. Với parser/index mới có thể giữ feature flag trong giai đoạn so sánh fixture.

## 7. Kiểm chứng audit ban đầu và giới hạn

- `npm run typecheck`: pass.
- `npm run build`: pass, có cảnh báo chunk >500 kB.
- `npm run test -- --run`: **37 files pass / 1 file fail; 130 tests pass / 5 fail**. Fail tại `scripts/phase5/resolve-predecessors.test.mjs`: thiếu artifact directories theo ngày cố định và một assertion parser mode trả exit 0 ngoài mong đợi. Không phải toàn bộ suite xanh.
- Probe tạm chạy riêng: 4/4 pass — 3 xác nhận hành vi hiện tại của B1/B2/B3; 1 control xác nhận close chặn pending read mở lại file. Probe dùng mocks/EditorState, không chứng minh native timing. File probe được xóa sau audit; các bước tái hiện được ghi ở trên để chuyển thành regression mong đợi đúng trong PR 0.
- Chưa chạy Rust/native integration suite, chưa đo release WebView input latency, chưa có tài liệu gốc trong ảnh để tái hiện đúng mọi chi tiết layout. Các finding ghi “rủi ro/cần regression” không được xem như bug đã tái hiện.
- Không dùng báo cáo phase cũ như bằng chứng benchmark hiện tại. `e2e/phase6.performance.spec.ts` kiểm tra harness/10k rows và elapsed ≥0, chưa đặt latency budget chứng minh performance đạt yêu cầu.

## 8. Đã triển khai trong lượt tiếp theo

- Code widget thay toàn bộ node fenced code khi render, không để hai dòng fence lộ ra. Chế độ view luôn giữ widget; chế độ edit-render chỉ mở source khi con trỏ vào block. Code dài giữ nguyên dòng và cuộn ngang trong khung, còn block trên 120.000 ký tự không chạy syntax highlighting.
- ArrowUp/ArrowDown trong edit-render phát hiện khi vertical movement mặc định sắp nhảy qua block widget, rồi ánh xạ về dòng code đang render để mở source tại vị trí tương ứng; Shift vẫn mở rộng selection.
- Highlight grammar tải theo ngôn ngữ khi widget xuất hiện; HTML plain được hiển thị trước khi module tải xong. Chart.js cũng chỉ tải khi chart widget được render. Build ban đầu giảm từ 1.141 kB / 376.71 kB gzip xuống 832 kB / 275.08 kB gzip cho chunk lớn nhất, giảm khoảng 27% ở cả hai số đo. Chunk chính vẫn vượt ngưỡng cảnh báo 500 kB.
- Cursor kiểm tra fenced code và active WikiLink bằng `syntaxTree.resolveInner`, bỏ lượt quét toàn bộ cây chỉ để tìm node đang chứa con trỏ. Full decoration rebuild khi tài liệu đổi vẫn còn và thuộc phạm vi PR incremental tiếp theo.
- `write_file` trả version token đúng với bytes đã commit. Frontend cập nhật token từ receipt, bỏ lần `read_file` toàn bộ tài liệu sau mọi lần save, và chỉ đọc lại khi watcher báo thay đổi trong lúc save để phân biệt sự kiện đến sớm/muộn.
- Watcher V2 là đường duy nhất cập nhật document; bỏ listener file/folder legacy trùng lặp. Conflict thật giữ nguyên draft; banner có hành động reload, hoặc ghi đè có chủ đích sau khi đọc token disk mới và vẫn dùng CAS ở write tiếp theo.
- Rust/frontend IPC contract và generated registry đồng bộ. Các mock write cũ trong `editor.phase1.test.ts` được cập nhật để trả write receipt.

Kiểm tra sau các thay đổi: `npm run typecheck`, `npm run lint` và `npm run build` pass; `cargo check --manifest-path src-tauri/Cargo.toml` pass; `node scripts/ipc/generate-contracts.mjs --check` và `node scripts/ipc/verify-handler-registry.mjs` pass. Bộ test **không chạy lại sau triển khai**. Con số 130 pass / 5 fail ở mục 7 là lượt audit trước khi sửa; cần chạy regression suite, nhất là native filesystem race và visual render, trước khi gộp.

Các PR còn lại trong plan vẫn cần: regression/native coverage cho save protocol, incremental block index cho edit-time full scans, cập nhật collection cache theo touched entries, watch-set diff, virtualized tree khi benchmark yêu cầu, rồi CI performance budgets và tách các service/store còn phụ thuộc vòng.
