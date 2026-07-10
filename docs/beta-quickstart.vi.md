# Hướng dẫn beta SpecRelay

Hướng dẫn này cài CLI `v0.1.0-beta.2` từ GitHub Release tarball, sau đó cài
plugin Codex từ Git marketplace SpecRelay. CLI và plugin là hai phần cài đặt
độc lập.

## Trước khi bắt đầu

- Cần Node.js 22+, npm 10+, Git và Codex desktop app.
- Chỉ cần Claude Code khi chạy `specrelay implement` thật; không cần để cài
  beta hoặc xem dry-run.
- Chỉ chạy trên repository bạn tin cậy. Không đưa credential, private diff hay
  raw artifact `.specrelay/` lên GitHub issue công khai.

## 1. Cài và kiểm tra CLI

```powershell
npm install --global https://github.com/thoinguyenhuu/SpecRelay/releases/download/v0.1.0-beta.2/specrelay-cli-0.1.0-beta.2.tgz
specrelay --version
specrelay doctor --json
```

Version phải là `0.1.0-beta.2`. Nếu không tìm thấy `specrelay`, hãy mở terminal
mới và kiểm tra thư mục npm global bin đã nằm trong `PATH` chưa.

## 2. Thêm plugin marketplace

```powershell
codex plugin marketplace add thoinguyenhuu/SpecRelay --ref v0.1.0-beta.2 --sparse .agents/plugins
codex plugin marketplace list
```

Khởi động lại Codex desktop app, mở Plugins directory, chọn **SpecRelay Beta**
và cài **SpecRelay**. Hãy mở một task mới sau khi cài để workflow skill được
nạp.

Plugin chỉ hướng dẫn Codex gọi CLI đã cài. Nó không lưu credential Claude,
không tự cấp quyền chạy Claude và không bypass các gate approval/an toàn của CLI.

## 3. Chạy fixture an toàn

Copy `examples/beta-fixture` sang thư mục riêng, khởi tạo Git repository và
tạo initial commit. Sau đó chạy:

```powershell
npm run lint
npm test
```

Trong task Codex mới, yêu cầu SpecRelay lập plan cho objective trong README của
fixture. Xem và duyệt plan trong chat. Luôn chạy `implement --dry-run` trước.
Chạy Claude thật là tùy chọn và chỉ nên thực hiện trong fixture tin cậy này.

## Khắc phục sự cố

- **Windows PowerShell:** mở PowerShell mới sau khi cài npm global. Dùng
  `Get-Command specrelay` và `Get-Command codex` để kiểm tra PATH.
- **Windows WSL:** cài Node, Git, Codex CLI và Claude Code bên trong WSL; không
  trộn Windows path với Linux path trong một run.
- **macOS/Linux:** mở shell mới, sau đó chạy `command -v specrelay` và
  `command -v codex`.
- **Không thấy plugin:** chạy `codex plugin marketplace list`, kiểm tra ref
  `v0.1.0-beta.2`, restart desktop app rồi cài trong Plugins directory.
- **Codex không chạy được shell:** dùng các lệnh `specrelay` tương tự trong
  terminal; workflow và artifact audit không đổi.

## Gửi phản hồi

Dùng GitHub issue form **Beta feedback**, chỉ gửi release tag, OS/tool version,
outcome và bước tái hiện đã sanitize. Với lỗ hổng bảo mật, dùng quy trình riêng
trong `SECURITY.md`.
