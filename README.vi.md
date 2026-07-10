# SpecRelay

> Quy trình duyệt plan và review cho Codex và Claude Code.

SpecRelay là CLI/plugin local-first để con người duyệt kế hoạch trước khi agent
sửa mã, lưu bằng chứng thực thi và tách reviewer khỏi executor.

Phase C đã có executor được kiểm soát: **draft plan → con người duyệt rõ ràng →
xác nhận triển khai riêng → Claude Code trong worktree cô lập**. Chat Codex là
giao diện chính để xem/sửa plan và theo dõi tóm tắt lifecycle; các file trong
`.specrelay/` là artifact nền để audit và resume, không phải nơi người dùng
phải đọc Markdown.

[Read the English README](README.md) · [Architecture](docs/architecture.md) ·
[Kế hoạch dự án tiếng Việt](docs/ke-hoach-open-source.md)

## Yêu cầu

- Node.js 22+
- npm 10+
- Git
- Claude Code chỉ bắt buộc khi chạy `specrelay implement`

`specrelay doctor` kiểm tra Git worktree, Claude print mode và cảnh báo Windows
trước khi bạn chạy executor.

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

## Quy trình Phase C

1. Làm rõ yêu cầu và xem/sửa plan tiếng Việt ngay trong chat Codex. Skill
   `specrelay-workflow` đặt quy ước chat-first này.
2. `specrelay plan` tạo run nháp; Codex ghi plan đã thống nhất vào `plan.md`.
   YAML front matter của file này là nguồn sự thật.
3. `specrelay show <run-id>` chỉ hiển thị thống kê gọn: mục tiêu, phạm vi, số
   bước, tiêu chí nghiệm thu, câu hỏi mở và trạng thái duyệt.
4. Chỉ sau khi bạn xác nhận rõ ràng ở chat hiện tại, Codex mới chạy
   `specrelay approve <run-id> --yes`. Lệnh validate plan và hash toàn bộ byte
   của `plan.md`.
5. Approval plan không tự gọi Claude Code. Chỉ sau một xác nhận triển khai riêng
   mới chạy `specrelay implement <run-id> --yes`. Lệnh từ chối base repo bẩn,
   tạo branch/worktree riêng và khởi động worker nền cục bộ.

Câu hỏi `blocking` chặn duyệt mặc định. Nếu `plan.md` thay đổi sau duyệt,
`show` báo `approval: stale` và executor từ chối chạy cho đến khi duyệt lại.

Trước khi chạy thật, dùng `specrelay implement --dry-run` để xem chính xác
worktree, branch, policy, giới hạn và prompt hash mà không tạo file hay process.
`status`, `cancel --yes`, `report` và `cleanup --yes` quản lý lifecycle. Cleanup
giữ lại artifact audit và từ chối xoá worktree có thay đổi.

## Lệnh hiện có ở Phase C

```text
specrelay doctor [--repo <path>] [--json]
specrelay init [--repo <path>] [--dry-run] [--json]
specrelay plan <objective> [--repo <path>] [--language vi] [--json]
specrelay show <run-id> [--repo <path>] [--json]
specrelay approve <run-id> --yes [--approved-by <label>] [--accept-open-questions --reason <text>] [--repo <path>] [--json]
specrelay implement <run-id> --yes [--repo <path>] [--max-turns <1..10>] [--timeout <duration>] [--dry-run] [--json]
specrelay status <run-id> [--repo <path>] [--follow] [--json]
specrelay cancel <run-id> --yes [--repo <path>] [--json]
specrelay cleanup <run-id> --yes [--repo <path>] [--json]
specrelay report <run-id> [--repo <path>] [--json]
```

`doctor` chỉ đọc. `init` tạo `.specrelay/config.json` và `.specrelay/runs/`
trong Git repository mục tiêu, sau đó thêm `.specrelay/` vào `.git/info/exclude`
cục bộ; không sửa `.gitignore`.

`plan` tạo `request.md`, `plan.md`, `state.json` và `events.jsonl` append-only.
`approve` tạo `plan.normalized.json` và `approval.json`. `implement` tạo thêm
policy snapshot, executor prompt, execution state, stream log đã redact/giới
hạn và executor summary. Không sửa trực tiếp JSON derived.

## Mặc định an toàn

- SpecRelay không có telemetry và không tự gọi network. Claude Code là process
  cục bộ riêng, có xác thực/network riêng của nó.
- Không đọc, lưu hoặc gửi API key/credential.
- Không ghi đè config hợp lệ; từ chối `.specrelay/` không do SpecRelay quản lý.
- Lệnh sửa run dùng lock độc quyền ngắn hạn, JSON state ghi atomic và event log
  chỉ append.
- `implement` từ chối base repo bẩn; không dùng shell, `--add-dir` hay
  `--dangerously-skip-permissions`.
- Đây là defense-in-depth, không phải sandbox. Chỉ chạy trên repository tin cậy
  và kiểm tra worktree trước mọi merge sau này.

## Chưa có ở Phase C

Phase C không chạy target test/build/package command, không có public diff,
không review code, không auto-fix finding, không commit/push/merge/publish/deploy
và không tự resume executor bị interrupted. Các phần đó thuộc phase sau.

SpecRelay dùng [Apache-2.0](LICENSE). Xem thêm
[CONTRIBUTING.md](CONTRIBUTING.md) và [SECURITY.md](SECURITY.md).
