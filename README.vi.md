# SpecRelay

> Quy trình duyệt plan và review cho Codex và Claude Code.

SpecRelay là CLI/plugin local-first để con người duyệt kế hoạch trước khi agent
sửa mã, lưu bằng chứng thực thi và tách reviewer khỏi executor.

Phase A mới tạo nền TypeScript offline. Chưa có lệnh gọi Claude Code, chưa tạo
plan/approval và chưa có tự động review.

[Read the English README](README.md) ·
[Kế hoạch dự án tiếng Việt](docs/ke-hoach-open-source.md)

## Yêu cầu

- Node.js 22+
- npm 10+
- Git

Codex và Claude Code chưa bắt buộc ở Phase A. `specrelay doctor` chỉ kiểm tra
binary có tồn tại hay không, không gọi agent và không kiểm tra credential.

## Phát triển

```bash
npm install
npm run validate
```

Chạy CLI trong lúc phát triển:

```bash
npm run dev -- doctor --json
npm run dev -- init --repo path/to/a/git-repository --dry-run
```

## Lệnh hiện có

```text
specrelay doctor [--repo <path>] [--json]
specrelay init [--repo <path>] [--dry-run] [--json]
```

`doctor` chỉ đọc. `init` tạo `.specrelay/config.json` và `.specrelay/runs/`
trong Git repository mục tiêu, sau đó thêm `.specrelay/` vào `.git/info/exclude`
cục bộ; không sửa `.gitignore`.

## Mặc định an toàn

- Không telemetry, network call hay chạy agent ở Phase A.
- Không đọc, lưu hoặc gửi API key/credential.
- Không ghi đè config hợp lệ; từ chối `.specrelay/` không do SpecRelay quản lý.

SpecRelay dùng [Apache-2.0](LICENSE). Xem thêm [CONTRIBUTING.md](CONTRIBUTING.md)
và [SECURITY.md](SECURITY.md).
