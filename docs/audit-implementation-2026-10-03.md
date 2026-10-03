# Triển khai audit và định vị Grav — 03/10/2026

## Hướng sản phẩm

Cấu hình một lần để công việc tự tiếp tục; không đặt việc ngồi canh và duyệt popup làm luồng chính. Đợt triển khai này kết nối permission-card autopilot, phục hồi executor và cải thiện khả năng tìm app. Những phần chưa có producer host đáng tin cậy được ghi riêng, không quảng cáo như tính năng hoàn chỉnh.

Thực hiện trên checkout chính `/Users/anle/Desktop/01_DEV_PROJECTS/MyApps/Grav` phiên bản 4.0.19, giữ các thay đổi đã có của người dùng. Bốn worker Orca cùng làm trên các file được phân công riêng; coordinator kiểm tra và nối transport, dashboard, tài liệu và packaging. Không lấy runtime cũ của worktree chat thay cho checkout chính.

## Đã kết nối vào runtime

| Hạng mục | Hành vi hiện tại | Giới hạn |
| --- | --- | --- |
| Setup một lần | Nút Set up Autopilot và command palette; Enable/Disable, Add, Remove, Save; tự sinh ID và gắn workspace; Cancel không ghi | Exact target, không wildcard; Observe/pause/dry-run vẫn có hiệu lực |
| Permission cards | Command, đọc/ghi file, đọc URL, thao tác URL và MCP qua evaluator chung của CDP/injected runtime | macOS IDE 2.5.5, commit được pin; scope đang chọn, không tự đổi radio; chưa có live receipt |
| Request lặp | Đọc props Wla/T9n phù hợp với UI để dùng cascade/trajectory/step thực; bước mới cùng nội dung được xử lý riêng | Thiếu/mismatch props dùng fingerprint bảo thủ; chưa xác nhận fiber trên card live |
| Phục hồi | CDP reconnect, observer repair, bridge restart; single-flight, generation fencing, burst budget/cooldown | Không khởi động lại job hoặc thử lại side effect chưa biết kết quả |
| Remount | Journal bounded lưu các attempt đã quan sát; seed/merge vào ledger trước lease có hiệu lực; cùng request không bị click lại | Journal trong extension-host memory; identity thay đổi, attempt chưa tới host và process restart vẫn là unknown |
| Metrics | Ledger job riêng, denominator gồm failure/unknown, setup tách can thiệp lúc chạy, waits/recovery-to-progress | Chưa có producer full-job lifecycle; completion rate live chưa có dữ liệu; click không được coi là success |
| Decision engine | Pure evaluator cho câu hỏi/form/plan từ rule cấu hình, fingerprint và revalidation | Chưa nối producer live; không có setting giả hoạt động, không tự chọn option đầu |

Các deny, command blacklist và local scoped rules vẫn được kiểm tra. Standing host grants bị từ chối nếu có thể làm mất cơ hội áp dụng local deny; thu hồi grant trong Grav không tự thu hồi quyền đã lưu bởi host. Default Once của card thông thường đã được xác nhận từ mã Wla; nó cho phép tự duyệt trong phạm vi cấu hình mà không cần chọn scope thủ công mỗi request.

## Định vị và từ khoá

Tên hiển thị: **Antigravity Auto Accept — Grav (Auto Approve / Auto Run)**. Giữ extension ID `ANLE.grav`, tên gói và version 4.0.19. Metadata, phần mở đầu README và changelog đã đồng bộ quanh cấu hình một lần và tự động hoá các flow được hỗ trợ.

Ưu tiên `Antigravity auto accept`, `auto accept`, `auto approve`, `auto run`; bổ trợ `accept all`, `auto clicker`, `auto scroll`, `autopilot`, terminal/approval/automation. Có 18 tags. Nghiên cứu phân biệt ngôn ngữ người dùng trong thảo luận công khai, tags do publisher chọn và lượt tải registry. Không có query logs/search volume nên không khẳng định keyword nào được tìm nhiều nhất hoặc bảo đảm tăng ranking. Chi tiết và nguồn ở [marketplace-keywords-2026-10-03.md](marketplace-keywords-2026-10-03.md).

## Kiểm chứng và việc còn lại

Baseline: 1013 assertions pass. Kiểm thử tích hợp, browser dashboard và package evidence ở `artifacts/audit-implementation-2026-10-03/`. Kết quả cuối: **1243 assertions pass, 0 fail, 0 infrastructure failures**; **23 browser checks pass**. VSIX `artifacts/grav-4.0.19-autopilot-discovery-2026-10-03.vsix`: 61 entries, 36 hash nguồn khớp checkout, ws 8.22.0; SHA-256 6c2e05d8a2a360975204c4709e2aac6904374ba713246793c941526853f4f5b9. Báo cáo máy đọc: `final-validation.json`. Không publish hoặc cài extension trong lượt này.

Read-only probe IDE đang mở ở CDP9333 không tìm thấy permission editor hay shared Submit đang chờ. Không tạo job, không bấm popup và không thay host settings để dựng kết quả. Installed-source mapping và synthetic replay chứng minh contract/cơ chế; chưa chứng minh job unattended hoàn tất trên host.

Roadmap còn: live permission capture/receipt, guarded scope switching, conversation scheduling hoặc background transport, producer question/form/plan và completion thực, retry/resume/quota theo budget, nhiều window/project và mapping build/platform khác. Đây là khoảng trống tự động hoá cần tiếp tục triển khai, không chuyển thành mục tiêu yêu cầu người dùng canh thủ công.

Tài liệu runtime: [autopilot](autopilot-implementation-2026-10-03.md), [recovery](recovery-implementation-2026-10-03.md), [decision engine](decision-engine-2026-10-03.md). Bản nghiên cứu marketplace trước được lưu lại cùng evidence riêng trong `artifacts/marketplace-followup-2026-10-03/` để không ghi đè snapshot đã có.
