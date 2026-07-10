# SpecRelay

> Quy trình duyệt plan và review cho Codex và Claude Code.

SpecRelay là CLI/plugin local-first để con người duyệt kế hoạch trước khi agent
sửa mã, lưu bằng chứng thực thi và tách reviewer khỏi executor.

Phase B đã có luồng đầu tiên: **draft plan → con người duyệt rõ ràng → plan đã
duyệt gắn hash**. Chat Codex là giao diện chính để xem và sửa plan; các file
trong `.specrelay/` là artifact nền để audit và resume, không phải nơi người
dùng phải đọc Markdown.

[Read the English README](README.md) · [Architecture](docs/architecture.md) ·
[Kế hoạch dự án tiếng Việt](docs/ke-hoach-open-source.md)

## Yêu cầu

- Node.js 22+
- npm 10+
- Git

Codex và Claude Code chưa bắt buộc. `specrelay doctor` chỉ kiểm tra binary có
tồn tại hay không; Phase B không gọi agent và không kiểm tra credential.

## Phát triển

```bash
npm install
npm run validate
```

Chạy CLI trong lúc phát triển:

```bash
npm run dev -- doctor --json
npm run dev -- init --repo path/to/a/git-repository --dry-run
npm run dev -- plan "Tạo module quản lý cơ sở giáo dục" --repo path/to/a/git-repository --json
```

## Quy trình Phase B

1. Làm rõ yêu cầu và xem/sửa plan tiếng Việt ngay trong chat Codex. Skill
   `specrelay-workflow` đặt quy ước chat-first này.
2. `specrelay plan` tạo run nháp; Codex ghi plan đã thống nhất vào `plan.md`.
   YAML front matter của file này là nguồn sự thật.
3. `specrelay show <run-id>` chỉ hiển thị thống kê gọn: mục tiêu, phạm vi, số
   bước, tiêu chí nghiệm thu, câu hỏi mở và trạng thái duyệt.
4. Chỉ sau khi bạn xác nhận rõ ràng ở chat hiện tại, Codex mới chạy
   `specrelay approve <run-id> --yes`. Lệnh validate plan, hash tất cả byte của
   `plan.md` và tạo artifact audit.

Câu hỏi `blocking` chặn duyệt mặc định. Override chỉ hợp lệ khi có cả
`--accept-open-questions` và `--reason "..."`; lý do và ID câu hỏi được lưu
lại. Nếu `plan.md` thay đổi sau duyệt, `show` báo `approval: stale` và phase
sau phải từ chối cho đến khi duyệt lại.

## Lệnh hiện có ở Phase B

```text
specrelay doctor [--repo <path>] [--json]
specrelay init [--repo <path>] [--dry-run] [--json]
specrelay plan <objective> [--repo <path>] [--language vi] [--json]
specrelay show <run-id> [--repo <path>] [--json]
specrelay approve <run-id> --yes [--approved-by <label>] [--accept-open-questions --reason <text>] [--repo <path>] [--json]
```

`doctor` chỉ đọc. `init` tạo `.specrelay/config.json` và `.specrelay/runs/`
trong Git repository mục tiêu, sau đó thêm `.specrelay/` vào `.git/info/exclude`
cục bộ; không sửa `.gitignore`.

`plan` tạo `request.md`, `plan.md`, `state.json` và `events.jsonl` append-only
cho một run. `approve` tạo thêm `plan.normalized.json` và `approval.json`;
không sửa trực tiếp hai file JSON này.

## Mặc định an toàn

- Không telemetry, network call hay chạy agent ở Phase B.
- Không đọc, lưu hoặc gửi API key/credential.
- Không ghi đè config hợp lệ; từ chối `.specrelay/` không do SpecRelay quản lý.
- Lệnh sửa run dùng lock độc quyền ngắn hạn, JSON state ghi atomic và event log
  chỉ append.
- CLI dùng error code ổn định cho automation và troubleshooting.

## Chưa có ở Phase B

Phase B không gọi Claude Code, không tạo worktree, không sửa mã nguồn target,
không chạy test target, không review diff, không commit/push/merge repository
target. Các phần đó thuộc các phase sau.

SpecRelay dùng [Apache-2.0](LICENSE). Xem thêm
[CONTRIBUTING.md](CONTRIBUTING.md) và [SECURITY.md](SECURITY.md).
