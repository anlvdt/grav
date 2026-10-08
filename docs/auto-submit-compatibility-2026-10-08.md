# Nghiên cứu Auto Run Pro và Antigravity Auto Submit

Ngày kiểm tra: 08/10/2026. Mục tiêu: áp dụng kỹ thuật phù hợp từ extension tham chiếu vào extension hiện có, đồng thời đổi thương hiệu thành Antigravity Auto Submit.

## Nguồn và kết luận

Đã đọc metadata Open VSX, README, changelog và mã JavaScript/PowerShell trong VSIX chính thức của [marcodelia.antigravity-auto-run-pro 1.9.7](https://open-vsx.org/api/marcodelia/antigravity-auto-run-pro/1.9.7). Metadata `latest` trả về 1.9.7 tại thời điểm kiểm tra. SHA-256 của VSIX tải về: `5c2c881f8414960d062b6cff2cb4b5250520b523c63f086d970f25da946afdb1`.

Từ 1.9.0, engine chính của extension tham chiếu là Windows UI Automation: một helper PowerShell chạy lâu dài, giao tiếp SCAN/CLICK qua stdin/stdout, tìm nút qua accessibility tree rồi gọi InvokePattern. Helper có fallback click tọa độ và bảo vệ TryGetClickablePoint khi API ném lỗi. Changelog giải thích việc CDP không hoạt động khi IDE khởi động thiếu cờ remote debugging; đây không phải bằng chứng về thay đổi toàn bộ DOM. UIA chỉ chạy trên Windows. Changelog 1.9.7 cũng nêu giới hạn thanh Accept all của batch file không xuất hiện trong accessibility tree.

Engine CDP phụ trong mã tham chiếu dùng Input.dispatchMouseEvent để gửi mousePressed/mouseReleased. Discovery native commands loại bỏ những tên mở settings/panel hoặc thao tác reject/cancel. Những tuyên bố về độ tin cậy trong README không được coi là kết quả kiểm thử của dự án này.

IDE cài trên máy này có `nameLong: Antigravity IDE`, `ideVersion: 2.5.5` trên macOS, đọc từ `/Applications/Antigravity IDE.app/Contents/Resources/app/product.json`. Đây là bản cài được quan sát, không phải xác nhận rằng mọi nền tảng hiện nhận cùng bản release. Helper PowerShell không thể được dùng trực tiếp trên máy này.

## Phần đã áp dụng

Engine CDP hiện tại dùng pointer input ở cấp trình duyệt cho nút thuộc document đang attach, theo [CDP Input.dispatchMouseEvent](https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchMouseEvent). Đây là implementation độc lập, không sao chép helper hoặc mã nguồn của extension tham chiếu.

Observer đánh giá policy và claim intent trước khi tạo ticket dùng một lần. Host chỉ xử lý ticket từ session Antigravity đã được kiểm tra. Renderer kiểm tra lại policy lease, identity/payload, enabled state, agent context và hit target, bao gồm open shadow roots. Tọa độ không được lấy từ console payload. Ticket có thời hạn một giây; pause, đổi policy, dispose hoặc reinjection hủy ticket cũ. Chuẩn bị click chuyển intent sang unknown; host lưu tombstone trước khi dispatch. Journal từ chối lưu thì không gửi input. Một press timeout vẫn dẫn đến một lần release, không lặp lại press và không fallback sang DOM click.

Phạm vi nested document dùng DOM activation để tránh dùng nhầm hệ tọa độ. Injected runtime giữ DOM activation vì không có transport CDP. Các nhánh chọn radio và trả lời question giữ cơ chế riêng hiện có. CDP vẫn cần bật remote debugging port và khởi động lại IDE; không có Windows UIA backend mới trong thay đổi này. Không bật các native terminal/permission APIs thiếu request identity và không sao chép God Mode. Gate phiên bản/commit hiện có của permission adapter được giữ nguyên.

Có khoảng thời gian giữa renderer validation và pointer dispatch; đây không phải giao dịch nguyên tử với DOM của host. UI postcondition cũng không chứng minh terminal command hoặc agent job đã hoàn tất. Kết quả chưa rõ không cấp quyền thử lại.

## Thương hiệu và cập nhật

Tên hiển thị chính xác: **Antigravity Auto Submit**, phiên bản 4.0.22. Cập nhật manifest, keyword, command titles, status bar, dashboard, thông báo và README. Giữ `name: grav`, publisher ANLE, extension ID ANLE.grav, command IDs, settings grav.*, storage keys, bridge protocol và .vscode/grav.json để các bản cài cũ tiếp tục cập nhật và giữ cấu hình. Không đổi repository URL hoặc các tài liệu lịch sử.

Kiểm tra dashboard trên Chromium phát hiện lỗi có sẵn: showToast đọc `_toastTimer` chưa khai báo, khiến xử lý save ACK/feedback dừng giữa chừng. Đã thêm khai báo timer, không thay đổi luồng lưu.

## Kiểm chứng và giới hạn

- Unit/renderer/transport suite: 1.483 assertions qua 43 test files, tất cả pass. Bao gồm kiểm tra unknown command, Observe, dry run, pause, policy revocation, foreign target, forged/expired/reused ticket, overlay, detached button, reinjection, journal refusal và lỗi transport.
- Chromium thực: 7 assertions pass, bao gồm iframe OOPIF offset ở origin khác. handler nhận isTrusted=false khi gọi DOM click và isTrusted=true khi dispatch qua CDP; ticket đã dùng không click lại.
- Dashboard browser suite: 23 checks pass. kiểm tra CSP, save ACK, feedback, confirmation, keyboard và giao diện sau đổi tên.
- Đóng gói VSIX và kiểm tra manifest, runtime dependencies cùng hash nguồn bằng quy trình sẵn có của repo.

Không tự động bấm các approval thật, chạy terminal command, cài VSIX vào IDE hoặc publish marketplace trong nghiên cứu này. Các kiểm thử Chromium dùng fixture; chưa có xác nhận end-to-end của bản 4.0.22 trong phiên agent thật của IDE.
