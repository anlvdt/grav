# Nghiên cứu extension tự động hoá Antigravity — 03/10/2026

## Mục tiêu sản phẩm đã sửa theo ý kiến người dùng

Grav phải giúp công việc tiếp tục và hoàn thành mà người dùng không cần ngồi canh. Thước đo chính là tác vụ hoàn thành không can thiệp, thời gian bị kẹt và khả năng tự phục hồi. Số click và số cảnh báo chỉ là dữ liệu hỗ trợ.

Nhận định trước đây “hiển thị rõ các yêu cầu cần người dùng xử lý” không phù hợp làm hướng cải tiến chính. Hướng đúng là cấu hình quyền và sở thích một lần, tự giải quyết các interaction trong phạm vi đó, tự tiếp tục sau gián đoạn. Các nhánh `manual` hiện có trong Grav là khoảng trống chức năng cần nghiên cứu và thay bằng adapter/decision flow thích hợp; không xem chúng là kết quả cuối cùng của autopilot. Những ngoại lệ thật sự thiếu thông tin có thể gom để xử lý từ xa, trong khi các tác vụ độc lập tiếp tục chạy.

## Phạm vi và cách kiểm chứng

- Antigravity IDE trên máy dùng Open VSX: đã đọc `extensionsGallery` trong `/Applications/Antigravity IDE.app/Contents/Resources/app/product.json`.
- Refresh trực tiếp hai registry với năm truy vấn: `antigravity`, `auto accept`, `auto approve`, `auto click`, `autopilot`. Open VSX tối đa 500 kết quả mỗi truy vấn; Microsoft lấy 100 kết quả đầu theo installs. Snapshot có timestamp UTC trong `artifacts/marketplace-followup-2026-10-03/ranking.json`.
- Lọc identifier tự động hoá và metadata có Antigravity. Đây là nhóm phổ biến nhất trong phạm vi truy vấn, không phải chứng minh đã vét toàn marketplace. Keyword tìm kiếm có thể bỏ sót tên sản phẩm khác.
- Open VSX dùng `downloadCount`; Microsoft xếp theo `install`, lưu thêm `downloadCount` riêng. Không cộng hai số, không coi chúng là người dùng duy nhất. Một extension có thể phát hành phiên bản khác nhau ở hai registry.
- Đã tải và kiểm tra tĩnh 12 VSIX: tám sản phẩm đầu của Open VSX và bốn sản phẩm đầu Microsoft. Không chạy mã extension đã tải. Metadata, URL gói, version, SHA-256, mã và bằng chứng dòng được lưu trong thư mục artifacts.
- Tiếp tục từ artifacts ở checkout chính `/Users/anle/Desktop/01_DEV_PROJECTS/MyApps/Grav`. So sánh Grav dùng mã mới và các sửa đổi sẵn có ở checkout đó. Worktree của chat là commit cũ `a8ad6fd`; không lấy mã cũ để khẳng định tính năng của bản mới. Hash các file đã đối chiếu nằm trong `grav-baseline.json`.
- Kết quả là nghiên cứu mã phát hành, chưa là thử nghiệm trực tiếp khả năng của các extension trên IDE hiện tại.

## Open VSX: nhóm auto-accept/autopilot

| Hạng | Extension | Lượt tải | Phiên bản |
| --- | --- | ---: | --- |
| 1 | [pesosz.antigravity-auto-accept](https://open-vsx.org/extension/pesosz/antigravity-auto-accept) | 351.532 | 1.2.0 |
| 2 | [zixfel.ag-auto-click-scroll](https://open-vsx.org/extension/zixfel/ag-auto-click-scroll) | 132.312 | 10.5.0 |
| 3 | [MunKhin.auto-accept-agent](https://open-vsx.org/extension/MunKhin/auto-accept-agent) | 131.443 | 13.0.0 |
| 4 | [hasugoii.agent-auto-approve](https://open-vsx.org/extension/hasugoii/agent-auto-approve) | 27.632 | 1.9.30 |
| 5 | [marcodelia.antigravity-auto-run-pro](https://open-vsx.org/extension/marcodelia/antigravity-auto-run-pro) | 26.940 | 1.9.7 |
| 6 | [antigitv.antigravity-auto-accept](https://open-vsx.org/extension/antigitv/antigravity-auto-accept) | 24.500 | 4.2.2 |
| 7 | [TureAutoAcceptAntiGravity.true-auto-accept-official](https://open-vsx.org/extension/TureAutoAcceptAntiGravity/true-auto-accept-official) | 22.784 | 99.9.37 |
| 8 | [kaushiksaravanan.auto-accept-antigravity](https://open-vsx.org/extension/kaushiksaravanan/auto-accept-antigravity) | 16.106 | 0.7.10 |

Các ứng viên tiếp theo: antigravity-unity.antigravity-always-run 15.612; ai-dev-2024.auto-all-antigravity 15.002; shinepcs.auto-antigravity 8.118; nextcortex.antigravity-auto-accept 7.120. Chưa đọc sâu mã của nhóm này.

Dashboard/quota là nhóm lân cận, không trộn vào bảng auto-accept: jlcodes.antigravity-cockpit 5.000.131; henrikdev.ag-quota 692.795; n2ns.antigravity-panel 425.528. Số liệu nằm trong snapshot tìm kiếm `openvsx-antigravity-0.json`; chúng hữu ích khi nghiên cứu quota và hiển thị tiến độ, nhưng không đại diện cho năng lực tự duyệt.

## Visual Studio Marketplace: nhóm tương tự

| Hạng | Extension | Cài đặt | DownloadCount riêng | Phiên bản |
| --- | --- | ---: | ---: | --- |
| 1 | [fhgffy.antigravity-auto-accept](https://marketplace.visualstudio.com/items?itemName=fhgffy.antigravity-auto-accept) | 5.134 | 499 | 5.1.0 |
| 2 | [nguyenhx2.antigravity-autopilot](https://marketplace.visualstudio.com/items?itemName=nguyenhx2.antigravity-autopilot) | 3.025 | 345 | 1.4.12 |
| 3 | [TJCG.auto-accept-claude-code](https://marketplace.visualstudio.com/items?itemName=TJCG.auto-accept-claude-code) | 2.921 | 398 | 0.5.0 |
| 4 | [Ezra.auto-accept](https://marketplace.visualstudio.com/items?itemName=Ezra.auto-accept) | 1.737 | 301 | 1.2.0 |
| 5 | [TECHNICALDOST.antigravity-auto-accept-pro](https://marketplace.visualstudio.com/items?itemName=TECHNICALDOST.antigravity-auto-accept-pro) | 1.034 | 270 | 1.0.0 |

TJCG được giữ vì trang sản phẩm ghi rõ hỗ trợ agent Antigravity, dù tên chứa Claude Code. zixfel ở Microsoft là 3.6.0, khác hẳn 10.5.0 ở Open VSX; marcodelia lần lượt 1.9.5 và 1.9.7. Cần ghi publisher, registry và version khi đối chiếu, tránh ghép tính năng giữa các bản.

## Bài học từ mã được phát hành

### 1. pesosz: nhận diện cả card permission và lựa chọn phạm vi

`main_scripts/auto-accept.js`, `tryApprovePermissionInContainer`, tìm marker permission/access, tập hợp nút của card và lựa chọn theo thứ tự conversation → once → always → allow chung. Thứ tự chính xác bổ sung cho ghi chú dở dang lượt trước: Always Allow không đứng trước Allow Once.

Điều Grav nên học: tự xử lý cả card và menu scope, không chỉ nút Run. Profile cấu hình một lần có thể quyết định dùng once, conversation hay phạm vi rộng hơn, rồi tự áp dụng cho các request phù hợp. Nên chọn scope theo cấu hình công việc, thay vì để vị trí hoặc nhãn nút quyết định quyền.

### 2. zixfel: background interaction là hướng nghiên cứu mạnh

`media/agentAutoScript.js` có `scanBackground`: gọi `GetAllCascadeTrajectories`, đọc `waitingSteps` và tạo payload gửi `HandleCascadeUserInteraction`. Chín nhánh hiện diện: permission, runCommand, approvalInteraction, filePermission, openBrowserUrl, executeBrowserJavascript, mcp, readUrlContent, askQuestion. Permission/filePermission dùng `PERMISSION_SCOPE_ONCE`; payload mang trajectoryId và stepIndex.

Đây là integration Antigravity Agent 2.0, chưa chứng minh chạy trên bản IDE của người dùng. Mã cho thấy một hướng xử lý request nền vượt giới hạn DOM đang hiển thị; không thể kết luận mọi background conversation của IDE đều bất khả thi chỉ từ DOM. Cần thử khả năng tương ứng của host IDE trước khi chọn transport.

Nhánh askQuestion chọn option đầu tiên; bộ đếm tăng trước khi request hoàn tất và lỗi gửi bị nuốt. Grav nên học cách phân loại interaction và giải quyết câu hỏi từ task context/sở thích đã cấu hình, đồng thời xác nhận host nhận quyết định và công việc tiếp tục. Option đầu tiên và số request đã gửi không đủ chứng minh tác vụ được giải quyết đúng.

### 3. zixfel: recovery có trạng thái và xác nhận ổn định

`src/recoveryPolicy.js` dùng heartbeat, ba lần mất tín hiệu, grace period, journal và giới hạn repair. Xác nhận renderer phục hồi cần ba heartbeat mới cùng renderer và preference đúng. `runRendererSupervisor` ở extension giữ IPC reconnect khi injection còn nguyên.

Grav nên ưu tiên tự reconnect/rebind/reinject ở phạm vi cần thiết và tiếp tục intent đang chờ. Bản zixfel vẫn có trường hợp yêu cầu reload từ người dùng; đây là giới hạn của sản phẩm đối chiếu, không phải mục tiêu cuối cho Grav. Recovery nên giảm thao tác thực tế, không chỉ đổi thông báo.

### 4. MunKhin: chạy nhiều hội thoại bằng luân phiên surface

`main_scripts/auto_accept.js`, `antigravityTabLoop`, mở danh sách hội thoại, chờ render, luân phiên tab và để vòng click riêng xử lý prompt. Session ID dừng callback của phiên cũ. Có theo dõi trạng thái hoàn tất từ UI.

Grav có thể dùng conversation scheduler khi host không có request transport phù hợp: chỉ luân phiên các hội thoại thuộc job đã chọn, chờ identity của surface mới trước actuation, giữ quyền và tiến độ riêng cho mỗi job. Badge phản hồi và tên tab là tín hiệu tham khảo; cần xác nhận kết quả công việc riêng.

### 5. marcodelia: executor thích ứng và chống kẹt

Mã bản 1.9.7 mặc định engine `uia`, helper PowerShell persistent, FIFO một request đang xử lý, cache RuntimeId chống click lặp; CDP là engine tùy chọn. Có anti-loop và tiếp tục khi UI thay đổi. `godMode` mở rộng permission nhưng mặc định false.

Bài học: chọn executor theo khả năng thật của host/platform, tự chuyển transport khi phù hợp, giữ một decision/intent chung. Helper UIA này thuộc Windows; trên máy macOS cần đánh giá Accessibility riêng. Setting có giá trị `auto` chưa chứng minh fallback đa nền tảng tự hoạt động.

### 6. fhgffy và antigitv: vòng worker đơn giản, khả năng nền có giới hạn

fhgffy 5.1.0 chạy Windows UIAutomation qua PowerShell, 500 ms scan/1.500 ms cooldown, ưu tiên InvokePattern rồi physical mouse fallback; worker chết sẽ restart sau ba giây nếu còn enabled. Đây là kiến trúc hiện tại, khác nhánh CDP cũ được changelog nhắc tới.

antigitv 4.2.2 spawn Python `uia_worker.py`, dùng Windows `uiautomation`, 250 ms scan và cooldown hai giây. Extension xử lý lỗi/worker exit nhưng đường close đã đọc không tự restart.

Grav nên học worker supervision để người dùng không phải khởi động lại thủ công. Cần đo hoạt động khi cửa sổ bị che/minimize; có helper native không tự chứng minh unattended reliability trên macOS.

### 7. TureAutoAccept: tránh dùng command polling gây đổi focus

Trong bản 99.9.37, `startPolling` ghi rõ CDP only, command polling disabled để tránh focus theft. Có cooldown theo text, fingerprint và reconnect WebSocket. Danh sách command cũ còn trong file không đồng nghĩa được gọi bởi vòng hiện tại.

Bài học: đừng chạy đồng thời nhiều executor trên một request chỉ để tăng số lần thử. Dùng ownership và identity chung; ưu tiên transport giúp tác vụ nền tiến triển mà ít ảnh hưởng công việc khác của người dùng.

### 8. kaushiksaravanan: tách đường nhanh/chậm và quyền settings

`out/autoAcceptor.js` có fast/full poll, single-flight, kiểm tra user interaction và loại run commands khỏi poll khi không phù hợp. Có CDP tùy chọn và settings lifecycle. Một số chặn command diễn ra sau terminal execution bằng Ctrl+C/dispose.

Grav nên giảm prompt ngay từ cấu hình host có hiệu lực, rồi dùng executor cho request còn lại. Các hook tương thích nhiều IDE cần xác minh hiệu lực trên Antigravity; chặn sau execution không thay thế quyết định trước execution.

### 9. TJCG và Ezra: phân biệt giảm prompt ở nguồn với bấm command

TJCG phối hợp host settings, Claude config/hooks và CDP. Mã bundle có các thao tác config tương ứng; tác dụng Claude không tự chuyển thành permission semantics của Antigravity. Có thể học mô hình setup một lần và khôi phục phần settings Grav sở hữu.

Ezra dùng document-change debounce 300 ms và timer, gọi mọi `targetCommands` không đối số. Default gồm `workbench.action.chat.acceptInput`, có chức năng khác approval tool. Đây là command automation tổng quát; Grav nên gọi đúng action trên đúng request, thay vì xem danh sách command dài là độ bao phủ tốt hơn.

### 10. hasugoii: giới hạn mức độ bằng chứng

Bundle `dist/extension.js` 2,26 MB bị obfuscate. Manifest và tài liệu giúp xác định ứng viên, còn vài string như Schedule/Retry/bannedCommands không chứng minh toàn bộ state machine hoạt động. Đã lưu gói và hash; chưa tuyên bố đã hiểu sâu executor hay scheduler của sản phẩm này.

## Đề xuất cụ thể cho Grav

So sánh với checkout chính: Grav đã có policy chung, leases, ledger, event scheduler, cooldown và pilot metrics. Không cần xây lại các cơ chế đó chỉ vì extension khác có. Khoảng trống cần ưu tiên là tự động giải quyết interaction và duy trì tiến độ công việc.

| Ưu tiên | Thay đổi cần thực hiện | Kết quả người dùng nhận được | Kiểm chứng cần có |
| --- | --- | --- | --- |
| P0 | Autopilot profile cấu hình một lần: operations, project/domain/tool, permission scope, retry budget và sở thích trả lời | Ít prompt lặp lại; tác vụ tiếp tục trong phạm vi người dùng chọn | Một profile xử lý cả chuỗi prompt mà không yêu cầu duyệt từng bước |
| P0 | Adapter permission card và menu scope; mở rộng file/URL/browser/MCP theo profile | Giải quyết các nhánh đang dừng ở `manual` | Replay card thật, scope/payload đổi, cùng quyết định qua các executor; host nhận đúng interaction |
| P0 | Recovery supervisor cho reconnect, renderer remount và worker failure | Tác vụ tự chạy tiếp sau lỗi kết nối | Mất CDP/bridge rồi phục hồi; không mất job, không lặp side effect |
| P1 | Conversation scheduler hoặc typed background transport sau khi xác minh host | Các job nền không chờ người dùng mở từng chat | Nhiều hội thoại cùng có request; attribution và kết quả riêng từng job |
| P1 | Decision engine cho câu hỏi/plan/form dựa vào yêu cầu tác vụ và preference | Giảm các bước hỏi lại có thể suy ra hoặc đã cấu hình | Câu hỏi đã có đáp án trong context tự xử lý; câu hỏi thiếu dữ kiện không chọn bừa option đầu |
| P1 | Theo dõi tiến độ và tự xử lý retry/resume/quota trong budget được cấu hình | Không phải canh Retry hoặc chờ quota thủ công | Phân biệt chờ hợp lệ, lỗi kết nối, task failure và quota; resume không tạo task trùng |
| P1 | Executor theo platform/capability, dùng ledger chung | Hoạt động nhất quán trên bản IDE được hỗ trợ | Background/minimized, reload, nhiều cửa sổ và một request chỉ có một owner |
| P2 | Báo cáo kết quả công việc, gom ngoại lệ; hỗ trợ xử lý từ xa khi cần | Người dùng xem thành quả và chỉ xử lý ngoại lệ thực sự | Không tự mở dashboard mỗi transition; tác vụ độc lập tiếp tục khi một job thiếu thông tin |

Việc dùng browser/MCP/file permissions hay scope dài hạn cần được thể hiện trong profile cấu hình, không biến thành hỏi lại từng prompt. Cấp quyền một lần cho công việc và tự áp dụng là một phần cốt lõi của automation.

## Thước đo đề nghị

1. Tỷ lệ job hoàn thành không có thao tác người dùng sau setup; mẫu số gồm cả job bị kẹt/thất bại.
2. Số can thiệp trên mỗi job, phân biệt setup ban đầu với can thiệp trong lúc chạy.
3. Thời gian chờ do approval, câu hỏi, quota và recovery; p50/p95 theo loại.
4. Tỷ lệ tự phục hồi và thời gian từ gián đoạn đến tiến độ thực tế, không chỉ WebSocket open.
5. Interaction đã nhận diện → quyết định → được host xác nhận → tác vụ tiếp tục/hoàn thành.
6. Request bị bỏ sót, xử lý sai job hoặc thử lặp cùng intent. Các số này giúp kiểm tra tự động hoá có làm đúng công việc.

`src/pilot-metrics.js` của checkout chính đã có userInterventions, recoveryMs và latency. Nó chưa đo job completion end-to-end; nên mở rộng ở lifecycle công việc khi thực hiện roadmap, không đổi tên click attempts thành success.

## Bàn giao và trạng thái

Đã hoàn thành refresh registry, xếp hạng, nghiên cứu tĩnh 12 gói và viết roadmap theo mục tiêu tự động hoá. Bằng chứng: `ranking.json`, `package-provenance.json`, `source-evidence.json`, `grav-baseline.json` và snapshots/source cùng thư mục artifacts. Không thực hiện các đề xuất roadmap vào runtime ở lượt nghiên cứu này. Chưa có thử nghiệm trực tiếp extension cạnh tranh trên IDE; các cơ chế tìm được là đầu vào cho implementation và verification tiếp theo.
