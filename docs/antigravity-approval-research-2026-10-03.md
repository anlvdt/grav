# Antigravity approval research — 2026-10-03

## Kết luận

Grav chưa có bằng chứng để tuyên bố xử lý mọi approval popup. Bộ kiểm thử cũ đạt nhưng không bao phủ semantics của permission card mới. Trong nghiên cứu này, fixture tái hiện việc Submit có thể duyệt một card permission hoặc gửi câu trả lời mà không kiểm tra operation/scope. Đã chặn generic Submit; Accept có command nay qua evaluator; các dấu hiệu permission, đọc URL, gửi terminal input, generic-tool và MCP đã biết chuyển manual. Đây là hardening có giới hạn, chưa phải adapter đầy đủ cho Antigravity IDE.

“Handle” cần gồm nhận diện, lấy đúng operation/payload/scope, quyết định theo policy, kiểm tra lại trước click, trace và chuyển người dùng khi không đủ bằng chứng. Không đồng nghĩa tự bấm mọi nút. Standing grants, câu hỏi, form, OAuth và dialog hệ điều hành không thể suy ra quyền từ nhãn nút.

## Phiên bản và bằng chứng

- Bản cài: /Applications/Antigravity IDE.app; product.json có ideVersion 2.5.5, editor version 1.107.0, commit ecfbad74d93962fc8ca485d93ab9b4f3d4cb6cf8, build date 2026-08-13.
- Changelog chính thức ghi IDE 2.5.5 ngày 13/08/2026. Antigravity 2.0 có nhánh release riêng, mới nhất được trang đánh dấu là 2.19.1 ngày 30/09/2026. Không dùng version của standalone để gọi bản IDE là cũ. Releases được rollout dần. [Changelog](https://antigravity.google/docs/changelog).
- Đã đọc bundle workbench.desktop.main.js và jetskiAgent/main.js, schema exports và call sites render/sendInteraction. Hai bundle đều có 41 tên schema interaction/spec; đây không phải 41 popup, vì có cặp request/response và schema không có UI đang hoạt động. Hash và danh sách đầy đủ nằm trong artifacts/approval-research-2026-10-03/host-inventory.json.
- Đã đọc UI bằng accessibility: cửa sổ Grav Dashboard và agent panel trống, không có approval đang chờ. UI Grav đang cài vẫn hiện ACTIVE và layout cũ. Source/VSIX mới chưa được cài vào app. Không gửi prompt, không duyệt popup, không đổi host permissions, không đọc conversation history hoặc token store.
- Static evidence chứng minh có nhánh code; không chứng minh feature flag, organization policy, platform hay server hiện cho phép nhánh đó xuất hiện.

## Tài liệu chính thức và giới hạn áp dụng

[Permissions](https://antigravity.google/docs/permissions/) mô tả namespaces command, filesystem, URL và MCP; thứ tự Deny, Ask, Allow; card có thể chỉnh target và phạm vi. Trang hiện đánh dấu Antigravity 2.0/CLI và tách macOS/Linux khỏi Windows. Semantics trên trang này là đầu mối đối chiếu, không phải bằng chứng DOM của IDE. Matrix bên dưới dựa riêng trên bundle IDE đã cài.

[IDE settings](https://antigravity.google/docs/settings?tab=ide) mô tả strict mode buộc review terminal, browser JavaScript và artifact; có workspace isolation. Do đó cùng operation có thể xuất hiện popup khác tùy setting.

[IDE browser allowlist](https://antigravity.google/docs/ide/allowlist-denylist) phân biệt domain allowlist và denylist; duyệt lâu dài cập nhật allowlist. Đây là thay đổi permission, khác với duyệt một lần. [Separate Chrome profile](https://antigravity.google/docs/ide/separate-chrome-profile) cho biết browser agent dùng profile riêng; không thể giả định nhìn thấy tab Chrome thường là thấy browser agent.

[MCP](https://antigravity.google/docs/mcp/) tách tool permission khỏi OAuth authentication. [Implementation plan](https://antigravity.google/docs/implementation-plan) mô tả review plan và Proceed trong conversation hoặc artifact header. [Sandbox](https://antigravity.google/docs/sandbox) tách phần IDE/standalone/CLI; ví dụ terminal số thứ tự của CLI không phải DOM fixture cho IDE.

## Inventory operation và UI đã tìm thấy

Ký hiệu: S = có call site/schema trong bundle IDE; D = tài liệu chính thức phù hợp; Q = schema tồn tại nhưng chưa tìm thấy call site active. “Manual” bên dưới chỉ mô tả quyết định hoặc hành vi không click; chưa đồng nghĩa đã có UI handoff chuyên biệt cho từng loại.

| ID | Nhóm | Bằng chứng/đường UI | Grav hiện tại và phần còn thiếu |
| --- | --- | --- | --- |
| A01 | Terminal command legacy | S: runCommand interaction; Accept/Reject | Có command literal thì áp dụng rules và blacklist; thiếu host receipt/cwd chắc chắn |
| A02 | Terminal command permission | S: permission resource command, card option + Submit | Submit manual; chưa đọc option được chọn và raw target từ typed host request |
| A03 | Sandbox escape | S: unsandboxed resource và cảnh báo quyền disk/network | Manual; không đồng nhất với grant command thông thường |
| A04 | File read ngoài workspace | S: read_file trên permission card | Manual; chưa có path grant evaluator/realpath/roots contract |
| A05 | File write/create/delete | S: write_file; file edit branches create/delete/overwrite | Manual nếu permission hint; edit diff acceptance và filesystem permission phải tách |
| A06 | File permission của subagent | S: filePermission; mặc định Allow in Conversation, menu Allow Once | Không tự duyệt; thiếu adapter nhận đúng path, request và scope |
| A07 | URL đọc nội dung | S: readUrlContent legacy Accept/Reject; read_url unified | Known legacy read prompt manual; chưa có URL/domain evaluator |
| A08 | URL actuation | S: execute_url và browserAction | Không có grant riêng; permission card manual |
| A09 | Browser action/screenshot/console | S: các renderers dùng confirmation wrapper, Confirm Browser Interaction | Labels Confirm mặc định không active; thiếu operation/URL/receipt adapter |
| A10 | Browser JavaScript | S: code preview, browserAction, Allow/Allow once/domain option | Không chứng minh được code/domain bằng command matcher; cần manual/adapter |
| A11 | Browser domain standing grant | S: domain option cập nhật allowlist; D | Không auto-write allowlist; cần phân biệt one-shot với host grant |
| A12 | Browser setup | S: openBrowserSetup, Setup/Deny, trạng thái loading | Chưa hỗ trợ; đây là setup/capability, không phải duyệt tool lần này |
| A13 | MCP tool legacy | S: mcp confirm và approvalInteraction tùy renderer | Known MCP/generic approval manual; không map tool args thành shell command |
| A14 | MCP unified permission | S: permission resource mcp | Submit manual; chưa đọc server/tool/args/scope bằng adapter |
| A15 | MCP elicitation form | S: requested JSON schema, string/number/boolean/enum/multi-select validation | Submit manual; app không tự điền/default đáp án cho người dùng |
| A16 | MCP elicitation URL | S: URL mode, Open URL/Decline | Chưa hỗ trợ; mở URL + chấp thuận elicitation khác với tool approval |
| A17 | Agent question | S: askQuestion, lựa chọn/write-in/multi-select, Continue/Submit/Skip | Submit manual; không tự chọn câu trả lời hoặc Skip chỉ để giải phóng agent |
| A18 | Ask-permission / custom permission | S: ask_permission, custom resource, persistence-only branch | Manual; custom không có namespace semantics mà Grav hiểu |
| A19 | Lưu rule host | S: cùng permission renderer; conversation/project/workspace/global scope | Submit manual; chưa có scope adapter; tuyệt đối không coi là one-shot |
| A20 | Hook/Ask-rule ép review | S: triggerSource EFFECTIVE_GRANT/FORCE_ASK_HOOK, các scope bị disable | Thiếu adapter đọc constraint; không dựa vào disabled label hay keybinding để bypass |
| A21 | Artifact/plan review | S: review preference và artifact routes; D: Proceed/Review/comments | Proceed thiếu command nên manual; cần artifact identity, revision, review target |
| A22 | Edit accept/reject/all | S: reviewChangesView, native edit action và file diffs | Giữ behavior hiện có; label Accept trùng tool approval, chưa đủ proof cho tất cả edit surfaces |
| A23 | Subagent approval forwarding | S: subagent-approve/subagent-deny, cascade ID | Approve thiếu command manual; cascade ID chỉ conversation, không đủ identity cho mỗi request |
| A24 | Terminal stdin confirmation | S: sendCommandInput với Accept/Reject | Known prompt manual; stdin có thể là đáp án destructive, không phải command mới |
| A25 | Error/retry/resume | S: error cards, retry callbacks; labels trong Grav | Không phải authorization proof; Retry/Resume có thể thực hiện lại side effect |

Các control surfaces phải đưa vào negative controls, không mặc nhiên auto-approve:

| Nhóm | Cách xử lý cần có |
| --- | --- |
| Workspace Trust / extension trust | Native host dialog; không dùng generic Trust/OK/Confirm làm agent grant |
| MCP OAuth / sign-in / verification | Chuyển người dùng, giữ nguyên credentials và consent scope |
| Billing / credits / overages | Không suy approval tài chính từ UI đang trong agent context |
| Undo / revert / delete / overwrite | Nhận diện riêng operation có ảnh hưởng dữ liệu; không bấm vì có nút Cancel bên cạnh |
| Install / setup / migration | Không trộn với approve tool call |
| Schedule / recurring tasks | Chưa tìm thấy active IDE approval call site xác minh các nhãn Schedule trong Grav; không lấy standalone feature làm proof IDE |
| Chrome native permission / certificate / file picker | Ngoài agent DOM; cần handoff và capability riêng, không scan nhãn chung |
| macOS privacy, Keychain, sudo/system auth | Ngoài CDP DOM; giữ manual, không lấy state Ready làm support claim |

Các schema Q cần kiểm chứng tiếp, không gán labels tự đoán: CascadeDeployInteraction, CascadeRunExtensionCodeInteraction, CascadeTaskResolutionInteraction, CascadeConfirmBrowserSetupInteraction. Browser pixel, screenshot, open URL và JavaScript có schema riêng bên cạnh wrapper browserAction. RequestedInteraction/CompletedInteraction là schema lifecycle, không tạo thêm một nhóm popup. Toàn bộ schema list đã được lưu để lần cập nhật app có thể diff.

## Những phát hiện ở Grav

1. Submit từng là command-free dù host dùng cùng nút cho permission, persistent grants và answers. Fixture chứng minh cả hai executor click mà không đọc operation. Đã sửa: generic Submit luôn manual, kể cả label có shortcut được matcher chuẩn hóa thành Submit.
2. Accept từng không đọc command trong executor. Đã sửa đường extraction, identity và revalidation để Accept có command đi qua evaluator; regression giữ exact allow và chặn git reset --hard ngay cả có legacy git grant.
3. actionContext từng chỉ tìm browser/MCP rồi mặc định terminal. Known permission resources, URL read, generic approval và stdin nay là restrictive hints. Các hints này chỉ từ chối auto-approval, không tự cấp quyền; không phải parser/adapter đủ bao phủ mọi host UI.
4. Generic Accept không có command và không khớp restrictive hints vẫn là rủi ro Legacy UI semantics. Browser contexts/labels chưa có typed payload. Không nên tuyên bố production-ready coverage rộng chỉ vì test hiện pass.
5. Quyền một lần và quyền dài hạn được đặt trong cùng card; nhãn Submit không mang scope. Target có thể chỉnh; confirm phải kiểm tra cả target lẫn selected scope/version ngay trước actuation.
6. Host sendInteraction dùng cascadeId, trajectoryId, stepIndex. Ledger Grav hiện dựa host data-request/tool-call/prompt attributes hoặc local fingerprint; chưa chứng minh các attributes này xuất hiện trên mọi card thực. Không được coi data-cascade-id là unique request ID.
7. Hai generic DOM executors không chạm được mọi native OS/Chrome dialog. Heuristics context, visibility, shadow DOM và iframe không thay được typed identity hay host receipt.
8. Capability manifest nay liệt kê rõ typed permission card, agent answers, MCP elicitation, sandbox scope và persistent host grants là unsupported. Ready chỉ là executor/policy lease readiness, không phải coverage certification.

## Probe và kiểm thử

Chạy node scripts/audit-approval-coverage.js: 36 synthetic cases × 4 permission profiles × 2 executors = 288 probes. Cases được lấy từ nhánh UI đã thấy và negative controls. Fixture dùng tool-step, visible connected button, fake timers/XHR, một exact tool status rule. Không chạy command thật, không gửi interaction vào host.

coverage-probe-before.json giữ baseline trước patch; coverage-probe.json là kết quả sau patch. Trường decision là evaluator với raw label; executor có thể chuẩn hóa shortcut label trước khi gọi evaluator. Không coi chênh lệch raw Submit ↵ là lỗi parity. Missing click không phân biệt skip, manual, unsupported, missing context; không tính nó là popup đã được nhận diện thành công. Probe không có host radio state, actual selected scope, portal layout hoặc native dialogs.

Regression mới: generic Submit không click qua cả hai executor và cả bốn profiles; known non-edit Accept manual; terminal Accept recheck blacklist/exact grant; observer hardening thay controller cũ thay vì reuse evaluator cũ. 35 checks mới. Bộ test đầy đủ sau patch: 1013 pass, 0 fail, 0 infrastructure failures. Chromium dashboard sau patch đạt 23 checks.

Baseline VSIX p1-p2 đã verify 54 entries/30 source hashes trước khi patch. Artifact đó không còn tương ứng source mới; phải dùng VSIX approval-research ở phần bàn giao. Không cài vào Antigravity trong nghiên cứu này.

## Contract cho adapter tiếp theo

Adapter cần lấy từ host request, không từ label thuần: host surface/build/platform, cascade/trajectory/step/request/tool-call identity; operation namespace; full command và cwd hoặc path/URL/server/tool/args; current target và edit state; scope once/conversation/project/workspace/global; grant persistence; selected option; forced Ask/hook constraints; request revision; policy version và live lease.

Chỉ actuation khi mapping host build đã verified, operation được explicit Grav rule cho phép, scope của UI đúng với authorization, user không đang nhập và payload/request/version còn nguyên. Handoff các câu hỏi, forms, unknown namespaces, persistent grants và OS/auth/billing. Nếu host báo Deny thì không có retry path để lách. Không dùng host-internal RPC sendInteraction để tự động ghi permission khi chưa có documented/verifiable contract.

Observed, classified, policy-decided, attempted, acknowledged và completed phải tách. UI biến mất/disabled chỉ xác nhận UI changed. Không coi command/process/tool đã hoàn tất. Unknown prompt cần visible diagnostic/handoff, có family và lý do; không chỉ âm thầm skip.

## Acceptance matrix cần hoàn thành trước claim coverage

1. Capture popup thật trong project disposable cho từng A01–A24 có thể kích hoạt: command sandbox/escape, file read/write, URL read/actuation, browser JS, MCP approval, form/URL elicitation, questions, plan và subagent. Các Q chỉ được chuyển sang supported khi feature actually reachable. Không auto-approve trong giai đoạn capture.
2. Mỗi capture ghi IDE build, OS, mode/strict settings, feature flags biết được, target/surface, request identity, screenshot/DOM đã redact, selected scope và actual host result. Đánh dấu không thể kích hoạt thay vì giả tạo fixture.
3. Replay cùng sanitized DOM qua CDP/runtime: exact rule, deny conflict, missing context, unknown type, mutable target, changing scope, permission preset/Ask hook, expired policy, typing/pause/dry-run, request revoke, retry và remount.
4. Đặc biệt: command rule không cấp unsandboxed grant; read_url không cấp execute_url; file read không cấp write; one-shot không được biến thành conversation/global; allow server/tool không cho elicitation answers hay OAuth consent.
5. Native dialogs, unrelated forms, install, trust, billing, undo và settings là negative controls. Không đồng nhất Skip trên browser với Skip All question/permission.
6. Build upgrade phải diff host schema/call-site signatures; chưa verify mapping mới thì manual. Multi-root/cwd, Windows legacy semantics, macOS/Linux sandbox và standalone phải có matrix riêng.
7. Báo số identified/supported/manual/unsupported/unknown theo từng family và phiên bản, latency có denominator, false approvals, misses, duplicates và actual receipt evidence. Zero failures ở synthetic fixture không tạo bảo đảm không bỏ sót production popup.

## Bàn giao

Research scripts, JSON evidence và báo cáo đều ở checkout; scripts/artifacts/report bị loại khỏi VSIX. Không thay app đã cài hoặc host settings. Adapter đầy đủ, live capture, dedicated handoff UI và validation đa nền tảng vẫn còn cần thực hiện; không đưa chúng vào danh sách đã hoàn thành.

- Runtime changes: src/action-policy.js, src/cdp-observer.js, media/runtime.js, src/capabilities.js; observer revision v4.0.22-approval. Extension version giữ 4.0.19.
- npm run release:check đạt. VSIX: artifacts/grav-4.0.19-approval-research.vsix; verifier đối chiếu source hashes và kiểm tra exclusions. Kết quả hash/package được lưu trong artifacts/approval-research-2026-10-03/package-verification.json.
- git diff --check sạch khi loại AGENTS.md có whitespace baseline đã tồn tại. Không sửa file hướng dẫn của người dùng.
