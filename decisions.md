# Decisions

## Index
| ID | Title | Status | Gist | Date |
|---|---|---|---|---|
| DEC-001 | Reveal active inline Markdown syntax in Write mode | Accepted | Reveal only intersected inline spans; keep rendered styles and inactive syntax hidden. | 2026-10-18 |
| DEC-002 | Keep whitespace drafts styled and commit valid Markdown on exit | Accepted | Recover active drafts with a same-length parser projection; normalize whitespace on exit and finish closers before Enter. | 2026-10-18 |
| DEC-003 | Hỗ trợ Windows, Linux và macOS ngay trong rebuild | Superseded by DEC-013 | CI và baseline phải bao phủ cả ba hệ điều hành. | 2026-10-18 |
| DEC-004 | Xếp hạng wikilink trùng tên và giữ cờ ambiguous | Accepted | Ưu tiên cùng thư mục, sau đó đường dẫn ngắn nhất; vẫn trả ứng viên và ambiguous. | 2026-10-18 |
| DEC-005 | Đặt mục tiêu collection ở 10.000 file | Accepted | 10k là quy mô mục tiêu; 1k và 5k là mốc đối chiếu, không phải giới hạn cứng. | 2026-10-18 |
| DEC-006 | Giải quyết conflict bằng so sánh và lựa chọn, giữ recovery draft | Accepted | Không tự merge ba chiều trong phạm vi rebuild này; giữ bản nháp để khôi phục. | 2026-10-18 |
| DEC-007 | Cho phép fast-check và dependency-cruiser trong devDependencies | Accepted | Dùng fast-check cho model-based tests và dependency-cruiser cho boundary checks. | 2026-10-18 |
| DEC-008 | Nghiệm thu Windows trước, tách kiểm chứng Linux/macOS | Superseded by DEC-013 | Task đạt checks Windows được Done; native Linux/macOS và đối chiếu toolchain theo TASK-086. | 2026-10-18 |
| DEC-009 | Chỉ định profile native zlib-ng dùng CRT tương thích Rust | Accepted | opt-level=1 riêng libz-ng-sys ở dev/test tránh CMake Debug chọn MSVCRTD; không suppress linker. | 2026-10-18 |
| DEC-010 | Quick Open chờ selection queue trước fallback open | Accepted | Giữ một đường mở file cho intent đã chọn; tránh duplicate request khôi phục note cũ. | 2026-10-18 |
| DEC-011 | Native Git pre-push hooks với Node runner | Accepted | Version hook/installer, configure local hooksPath, chạy typecheck/lint và giữ hooks riêng. | 2026-10-19 |
| DEC-012 | Version policy main với status checks trực tiếp | Superseded by DEC-013 | Sáu check canonical từ GitHub Actions app được bắt buộc; validator giữ policy khớp workflow. | 2026-10-19 |

| DEC-013 | Focus current rebuild on Windows | Accepted | All CI gates run Windows; Linux/macOS work paused. | 2026-10-19 |

| DEC-014 | Require explicit document write preconditions | Accepted | Version/CreateNew/Overwrite cross IPC and repository ports; no omitted-token write. | 2026-10-19 |

| DEC-015 | Report post-commit failures as receipt warnings | Accepted | A published document remains successful; token and warnings let callers advance safely. | 2026-10-19 |

| DEC-016 | Lifecycle and navigation workflow ownership | Accepted | App wires UI; workflows own startup subscriptions, close barriers and serialized navigation. | 2026-10-21 |

## DEC-001 — Reveal active inline Markdown syntax in Write mode
Date: 2026-10-18 · Status: Accepted · Related: `RenderPlugin`, TASK-001

**Problem** — Hidden atomic delimiters prevent users from seeing and editing the boundaries of bold, italic, and similar inline formatting. Empty bold pairs are parsed as horizontal rules.

**Options**
- A — Reveal all syntax on the selected line. Simple, but also changes headings, links, and unrelated inline spans as the caret moves.
- B — Reveal delimiters only for inline spans intersecting the selection. Requires selection-driven decoration refresh, but retains styled contents and limits layout changes to the formatting being edited.

**Decision** — Use B for bold, italic, strikethrough, and inline code in editable Write mode. Derive delimiter extents from parser marker nodes. Show active empty star/underscore formatting runs instead of a horizontal rule. Keep Read mode fully rendered.

**Reason** — The user explicitly requests visible Markdown delimiters within active formatting. Selection-local changes preserve other rendered blocks while making each delimiter character reachable with ordinary cursor movement.

**Consequences** — Inline geometry can change on entering/leaving a formatted span. Selection changes must rebuild both decorations and atomic ranges; keyboard and pointer regression coverage must exercise the transitions.

## DEC-002 — Keep whitespace drafts styled and commit valid Markdown on exit
Date: 2026-10-18 · Status: Accepted · Related: `inline-formatting.ts`, `RenderPlugin`, `formatting-keymap.ts`, TASK-002; extends DEC-001

**Problem** — Typing a space before an emphasis closer produces `**text **`, which the standard Markdown parser no longer recognizes. Enter before a closer moves it into the next paragraph/list item.

**Options**
- A — Relax the shared Markdown grammar to accept whitespace-padded emphasis. Simple rendering, but makes saved Markdown nonstandard and changes Read/Source interpretation.
- B — Recover only active drafts with the standard parser over a same-length projection. Commit trailing whitespace outside the closing markers when leaving, and compose existing newline commands after closing formatting. More editor logic, but preserves standard saved Markdown and ordinary code/Source behavior.

**Decision** — Use B. `inlineFormattingAt` validates candidate trailing-space drafts using Lezer and retains source offsets. Rendering does not modify the source. A Write-only selection transaction filter moves trailing whitespace outside closing markers when leaving a nonempty draft. The Write Enter command finishes terminal emphasis/strike markers, then invokes the existing Markdown newline/list command or normal newline command as one undoable transaction. Empty emphasis is removed before normal Enter handling; mid-content Enter and code/Source use their existing behavior.

**Reason** — The requested editing experience needs stable formatting while typing incomplete Markdown and valid output when the user finishes it. Reusing the standard parser and newline commands preserves delimiter escaping, code exclusions, list continuation, and history behavior without replacing the grammar.

**Consequences** — Leaving an invalid trailing-space draft changes delimiter placement while preserving whitespace and textual content. Enter inherits the standard Markdown command's trailing-whitespace cleanup in lists. Read mode remains strict Markdown; unfinished drafts are only recovered in Write mode.

## DEC-003 — Hỗ trợ Windows, Linux và macOS ngay trong rebuild
Date: 2026-10-18 · Status: Superseded by DEC-013 · Related: TASK-005

**Problem** — Phạm vi nền tảng quyết định matrix CI và bằng chứng an toàn dữ liệu/hiệu năng của rebuild.

**Options**
- A — Windows và Linux trước, bổ sung macOS sau. Ít runner hơn nhưng chưa chứng minh hành vi trên macOS.
- B — Windows, Linux và macOS ngay từ đầu. Có bằng chứng đủ ba nền tảng nhưng tăng thời gian CI và lượng baseline cần thu.

**Decision** — Hỗ trợ Windows, Linux và macOS ngay từ kế hoạch hiện tại. Matrix backend dùng ubuntu-latest, windows-latest, macos-latest; baseline release thu trên cả ba. Các phép kiểm tra đặc thù nền tảng chạy trên runner phù hợp.

**Reason** — Người dùng yêu cầu bổ sung macOS ngay khi chấp thuận TASK-005; đây là phạm vi sản phẩm được chọn, không phải kết luận rằng Linux và macOS có hành vi giống nhau.

**Consequences** — Cập nhật TASK-007, TASK-008, TASK-014, TASK-015, TASK-019, TASK-033, TASK-036, TASK-041 và TASK-083. Giữ test ReplaceFileW trên Windows; kiểm chứng riêng nhánh unix và filesystem semantics trên Linux/macOS. Chưa thay workflow hay chạy baseline trong task quyết định này.

## DEC-004 — Xếp hạng wikilink trùng tên và giữ cờ ambiguous
Date: 2026-10-18 · Status: Accepted · Related: TASK-005

**Problem** — Resolve theo tên có thể gặp nhiều note cùng tên; kết quả cần ổn định và UI phải biết sự mơ hồ.

**Options**
- A — Lấy kết quả đầu tiên từ DB. Ít logic nhưng phụ thuộc thứ tự truy vấn và không thể hiện sự mơ hồ.
- B — Xếp hạng cùng thư mục rồi đường dẫn ngắn nhất, kèm ứng viên và ambiguous. Có quy tắc dễ dự đoán nhưng cần DTO và UI tương ứng.
- C — Luôn bắt người dùng chọn. Rõ ý định nhưng tăng thao tác cho mọi trùng tên.

**Decision** — Ưu tiên note cùng thư mục với note nguồn; sau đó ưu tiên đường dẫn ngắn nhất. Khi có nhiều ứng viên hợp lệ, trả danh sách ứng viên và cờ ambiguous kể cả khi có ứng viên đứng đầu. Batch resolve và UI dùng cùng thứ tự.

**Reason** — Người dùng chấp thuận đề xuất số 2 của TASK-005. Quy tắc giúp kết quả có thứ tự dự đoán được, đồng thời giữ thông tin để UI thể hiện và cho chọn khi mơ hồ.

**Consequences** — TASK-053 đặc tả cách đo độ ngắn và tie-break ổn định trước khi triển khai; không dựa vào thứ tự DB. TASK-054 và TASK-075 dùng kết quả/định danh tương ứng. Đây chưa phải thay đổi runtime.

## DEC-005 — Đặt mục tiêu collection ở 10.000 file
Date: 2026-10-18 · Status: Accepted · Related: TASK-005

**Problem** — Cần quy mô cụ thể để chọn fixture và đánh giá watcher, metadata cache, tree render.

**Options**
- A — Mục tiêu 1k file. Chi phí kiểm chứng thấp nhưng phạm vi nhỏ.
- B — Mục tiêu 10k file. Bao phủ quy mô đã đề xuất với fixture 1k/5k đối chiếu.
- C — Mục tiêu 100k file. Phạm vi rộng hơn nhưng đòi hỏi thêm fixture và ngân sách chưa được đo.

**Decision** — Lấy 10.000 file làm quy mô collection mục tiêu; baseline vẫn đo 1k, 5k và 10k. Đây là mục tiêu nghiệm thu, không thêm giới hạn từ chối collection lớn hơn.

**Reason** — Người dùng chấp thuận đề xuất số 3 của TASK-005. Mục tiêu này xác định khối lượng kiểm chứng trước khi thay watcher/cache.

**Consequences** — TASK-038 đo đủ ba kích thước. Ngân sách thời gian/bộ nhớ chỉ chốt tại TASK-041 sau số đo trên ba OS; chưa coi mục tiêu quy mô là bằng chứng hiệu năng đạt.

## DEC-006 — Giải quyết conflict bằng so sánh và lựa chọn, giữ recovery draft
Date: 2026-10-18 · Status: Accepted · Related: TASK-005

**Problem** — External change, rename/delete hoặc lỗi trong save có thể khiến bản đang sửa khác bản trên đĩa.

**Options**
- A — So sánh và để người dùng chọn bản, giữ recovery draft. Phù hợp các nhánh conflict đã yêu cầu nhưng cần thao tác của người dùng.
- B — Merge ba chiều tự động. Có thể giảm thao tác khi merge được nhưng cần quản lý bản gốc và thêm quy tắc/xử lý xung đột.

**Decision** — Trong phạm vi này, cung cấp so sánh và lựa chọn bản của mình/bản ngoài; giữ recovery draft trước nhánh có thể loại bỏ nội dung. Không triển khai merge ba chiều tự động. Ghi đè vẫn phải qua precondition/token hợp lệ.

**Reason** — Người dùng chấp thuận đề xuất số 4 của TASK-005; phạm vi ưu tiên bảo toàn nội dung và quyền lựa chọn khi xử lý conflict.

**Consequences** — TASK-063 bao phủ giữ bản mình, lấy bản ngoài, file ngoài bị xóa/đổi tên và thay đổi trong lúc save; không bỏ recovery ở bất kỳ nhánh có nguy cơ mất dữ liệu nào. CAS và receipt đã lên kế hoạch vẫn giữ.

## DEC-007 — Cho phép fast-check và dependency-cruiser trong devDependencies
Date: 2026-10-18 · Status: Accepted · Related: TASK-005

**Problem** — Save state machine cần kiểm tra nhiều thứ tự sự kiện; quy tắc phụ thuộc frontend cần kiểm tra tự động.

**Options**
- A — Tự viết generator chuỗi sự kiện và rule kiểm phụ thuộc. Ít package nhưng phải tự duy trì generator và phân tích dependency.
- B — fast-check và dependency-cruiser ở devDependencies. Có công cụ chuyên dụng nhưng tăng dependency phục vụ phát triển.

**Decision** — Cho phép thêm fast-check và dependency-cruiser vào devDependencies khi triển khai task tương ứng: fast-check ở TASK-061, dependency-cruiser ở TASK-071. Không đưa hai package vào dependencies runtime.

**Reason** — Người dùng chấp thuận đề xuất số 5 của TASK-005. Hai công cụ phục vụ model-based tests và kiểm tra boundary theo kế hoạch.

**Consequences** — Chưa cài package trong TASK-005. Task triển khai cập nhật lockfile, chọn phiên bản tương thích lúc thực hiện và ghi bằng chứng sử dụng; các gate cycle/boundary hiện có vẫn cần được đáp ứng.

## DEC-008 — Nghiệm thu Windows trước, tách kiểm chứng Linux/macOS
Date: 2026-10-18 · Status: Superseded by DEC-013 · Related: TASK-086, TASK-007, TASK-008, DEC-003

**Problem** — Máy dev Windows không thể cung cấp bằng chứng native Linux/macOS; chờ đủ ba OS đang chặn đóng task dù phần sửa và checks Windows đã đạt.

**Options**
- A — Chỉ Done khi đủ ba OS trên từng task. Bằng chứng gắn từng task nhưng chặn tiến độ khi thiếu runner.
- B — Done theo acceptance Windows, chuyển kiểm chứng Linux/macOS sang một task riêng. Tiếp tục triển khai được nhưng phải giữ phần kiểm chứng nền tảng trong nghiệm thu tổng thể.

**Decision** — Theo yêu cầu trực tiếp của người dùng, nghiệm thu task trên Windows trước; Done khi checks Windows pass. TASK-086 quản lý phần native Linux/macOS và đối chiếu toolchain CI ghim. Không đổi phạm vi hỗ trợ Windows/Linux/macOS tại DEC-003.

**Reason** — Người dùng chọn tách công việc nền tảng để tiến hành tuần tự trên môi trường hiện có.

**Consequences** — TASK-007 được Done từ kết quả Windows đã có; TASK-008 chạy fmt/clippy/test Windows. Các task tiếp theo phải ghi bằng chứng Windows và chuyển checks ngoài Windows về TASK-086 khi áp dụng. Gate nghiệm thu tổng thể vẫn phải có bằng chứng native Linux/macOS; không suy ra pass từ Windows.

## DEC-009 — Chỉ định profile native zlib-ng dùng CRT tương thích Rust
Date: 2026-10-18 · Status: Accepted · Related: TASK-087

**Problem** — Linker Windows báo LNK4098. dumpbin xác nhận libz-ng-sys 1.1.29 tạo zlibstatic-ngd.lib yêu cầu MSVCRTD; các native libraries sqlite3, bzip2, zstd và vswhom yêu cầu MSVCRT.

**Context** — Chuỗi dependency là zip → flate2 → libz-ng-sys. Build script libz-ng-sys dùng CMake; cmake 0.1.58 chọn Debug khi OPT_LEVEL=0, RelWithDebInfo khi OPT_LEVEL=1 và DEBUG=true. CMake project chọn runtime Debug trong cấu hình Debug.

**Options**
- A — Thêm NODEFAULTLIB để bỏ thư viện xung đột. Ít thay đổi nhưng không sửa native library đã được build cho runtime khác.
- B — Đặt opt-level=1 riêng cho libz-ng-sys trong profile.dev.package; test kế thừa. CMake chuyển sang RelWithDebInfo, dùng CRT không Debug tương thích Rust. Không thay version, feature hoặc compression backend.
- C — Vendor/patch build script dependency để ép CMAKE_MSVC_RUNTIME_LIBRARY. Điều khiển trực tiếp nhưng thêm nguồn vendor và chi phí duy trì cho thay đổi nhỏ này.

**Decision** — Dùng B: [profile.dev.package.libz-ng-sys], opt-level=1 trong src-tauri/Cargo.toml. Xác minh directives của library mới và kết quả link không còn LNK4098, rồi chạy đầy đủ gate backend Windows.

**Reason** — Bằng chứng native chỉ ra đúng dependency và nguồn chọn profile. Package override sửa cấu hình tạo thư viện mà không che cảnh báo hoặc đổi implementation ZIP. Cargo hỗ trợ package profile overrides và test kế thừa dev.

**Consequences** — Chỉ native zlib-ng trong dev/test được tối ưu mức 1; release giữ profile cũ, code app vẫn giữ debug. Cấu hình áp dụng portable, Linux/macOS kiểm chứng riêng TASK-086. Không sửa Cargo cache, không thêm linker suppression. Nguồn tham khảo: https://doc.rust-lang.org/cargo/reference/profiles.html.

## DEC-010 — Quick Open chờ selection queue trước fallback open
Date: 2026-10-18 · Status: Accepted · Related: TASK-011, TASK-067

**Problem** — Quick Open vừa selectEntry (kích hoạt selection effect trong App), vừa openFile trực tiếp. Hai open request cạnh tranh; request bị thay thế có thể restoreDisplayedSelection về note cũ. Regression ghi Third.md, Third.md, First.md.

**Options**
- A — Tiếp tục mở trực tiếp và điều chỉnh thời gian bằng delay. Không giải quyết ownership hoặc bảo đảm hết race.
- B — Chờ selectionTransition hiện có, kiểm tra selection/collection vẫn là intent ban đầu, chỉ fallback open nếu file chưa đúng. Sửa hẹp, giữ các contract và đường save.
- C — Viết lại toàn bộ selection coordinator ngay. Bao quát hơn nhưng thuộc TASK-067 và tăng phạm vi Phase 0.

**Decision** — Dùng B. App.openQuickCandidate await selectionTransition sau selectEntry; bỏ qua fallback khi selection/collection đã đổi. Giữ fallback để tương thích các candidate chưa được selection effect mở.

**Reason** — Bằng chứng đỏ/IPC chỉ rõ hai đường mở cùng cạnh tranh. Dùng một queue hiện có loại race mà không đưa rebuild Phase 5 vào bản vá.

**Consequences** — Quick Open, collection overview và content search dùng cùng điều phối. Regression phải giữ một read cho intent thường, đúng path/content. TASK-067 sau này vẫn phải bảo toàn quy tắc này khi thêm cancellation tổng quát.

## DEC-011 — Native Git pre-push hooks với Node runner
Date: 2026-10-19 · Status: Accepted · Related: TASK-013

**Problem** — Repo cần chặn type/lint failures trước push và cài hook tái lập trên Windows/fresh clone.

**Options**
- A — Husky hoặc framework hook tương tự. Có lifecycle hỗ trợ nhưng thêm dependency cho một hook.
- B — Git core.hooksPath local và .githooks versioned, Node runner/installer. Dùng Git/Node hiện có; cần tự kiểm tra newline/mode và preserve hooks hiện hữu.

**Decision** — Dùng B. prepare và hooks:install chạy installer local; pre-push gọi Node runner chạy typecheck rồi lint, propagate exit code. .gitattributes giữ hook LF và Git index giữ executable. Installer giữ cấu hình/custom hooks khác, skip source archive không Git.

**Reason** — Phạm vi chỉ một gate trước push, không cần dependency mới. Git fixture kiểm chứng chính hook bằng push fail/pass; direct Node/npm-cli invocation tránh shell .cmd fallback trên Windows.

**Consequences** — Maintainer cài dependencies hoặc chạy hooks:install sau clone. Custom-hook users tích hợp runner vào hook riêng. test:hooks dùng TypeScript/ESLint thật, local bare remote, fresh clone và không ghi remote production. Nguồn: https://git-scm.com/docs/githooks, https://docs.npmjs.com/misc/scripts/.

## DEC-012 — Version policy main với status checks trực tiếp
Date: 2026-10-19 · Status: Superseded by DEC-013 · Related: TASK-014, TASK-015

**Problem** — Main chưa protected và năm CI push gần nhất fail. Cần yêu cầu các job canonical và ba backend OS đạt trước merge.

**Options**
- A — Thêm aggregate job rồi chỉ bắt buộc aggregate. Giữ một context ổn định nhưng thêm job phụ thuộc và logic xác minh trạng thái/skipped.
- B — Bắt buộc sáu contexts hiện hữu trực tiếp, version policy và validate mapping với YAML. Không thêm runner nhưng phải cập nhật mapping khi đổi tên job/matrix.

**Decision** — Dùng B: frontend, browser, phase0-smoke và backend ba OS từ app 15368 đã được xác minh qua API. strict=true, enforce_admins=true; không cho force push/delete main. Script verify-policy kiểm tra mapping/ba OS/fail-fast. Áp dụng policy bằng admin API ngoài workflow CI.

**Reason** — Các check names/App ID đã được xác minh trên repo thực. Validator chặn drift, còn GitHub enforce check nguồn đúng app mà không thêm token admin vào CI.

**Consequences** — CI chạy hook/policy regressions; policy áp dụng cho admin. PR lỗi type phải blocked. Ba main push xanh vẫn cần lịch sử thực; không được suy từ local hoặc tạo push giả để đủ số lần.


## DEC-013 — Focus current rebuild on Windows
Date: 2026-10-19 · Status: Accepted · Related: TASK-089; supersedes DEC-003, DEC-008 and the platform scope of DEC-012.

**Problem** — The user now requests work only on Windows.

**Options**
- A — Keep three OS gates: continues native coverage but requires work outside the requested scope.
- B — Run all gates on Windows and pause native follow-ups: matches current scope but leaves other platforms unverified.

**Decision** — Use B. Require frontend, browser, phase0-smoke and backend (windows-latest); pause TASK-086. Preserve existing non-Windows implementations.

**Reason** — Explicit user direction supersedes the earlier three-platform acceptance scope.

**Consequences** — Linux/macOS failures are retained as historical evidence, with no fixes or verification scheduled. TASK-014 still needs three genuine green main push runs under Windows scope.

## DEC-014 — Require explicit document write preconditions
Date: 2026-10-19 · Status: Accepted · Related: TASK-018.

**Problem** — Optional tokens allow callers to bypass conflict checks.

**Options**
- A — Keep optional tokens and validate callers: compatible but leaves a blind-write path.
- B — Require a tagged Version/CreateNew/Overwrite union: changes contracts and ports but makes every write intent explicit.

**Decision** — Use B. Existing and overwrite writes recheck the observed disk token immediately before publication; CreateNew delegates to exclusive create_file. Only the IPC boundary accepts an omitted value to return precondition_required.

**Reason** — This implements the approved task requirement and preserves external changes across ordinary and explicit-overwrite saves.

## DEC-015 — Report post-commit failures as receipt warnings
Date: 2026-10-19 · Status: Accepted · Related: TASK-019, TASK-020.

**Problem** — Returning an error after the new bytes are published causes callers to retain an old token and retry an already committed save.

**Options**
- A — Return an error for backup cleanup: reports maintenance failure but misrepresents the disk version.
- B — Return the committed token with warnings: preserves save truth while surfacing maintenance failure separately.

**Decision** — Use B. Precommit errors remain errors; cleanup/durability failures after publication become receipt warnings. Frontend shows a dismissible save notice and advances the token/clean state without retrying.

**Reason** — Disk publication is the save boundary. A real Windows locked-backup regression confirms the new bytes/token exist even when backup deletion fails.

## DEC-016 — Lifecycle and navigation workflow ownership
Date: 2026-10-21 · Status: Accepted · Related: TASK-108 (plan TASK-008)

**Problem** — App mixes startup subscriptions, close/save barriers, selection queues and rendering, making lifetime and navigation regressions difficult to isolate.

**Options**
- A — Keep all orchestration in App; fewer modules but unrelated rendering and subscription lifetimes remain coupled.
- B — Extract narrowly owned workflows with explicit UI callbacks; adds wiring but retains existing store/API boundaries and testable close behavior.

**Decision** — Use AppLifecycleWorkflow for startup/subscription/close ownership and NavigationWorkflow for serialized selection and search/history navigation. Keep rendering and modal signals in App. Register cleanup synchronously and dispose subscriptions even if their asynchronous registration finishes after unmount.

**Reason** — This moves existing behavior without introducing an event bus or changing save ordering, keyboard shortcuts or modal timing.
