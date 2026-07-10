# SpecRelay

> Quy trình coding đa model có plan được con người duyệt.

SpecRelay là CLI/plugin local-first để Codex điều phối và review, còn Claude
Code triển khai trong worktree riêng:

```text
Codex chat lập plan → người dùng duyệt → Claude Code triển khai cô lập
→ chạy check đã duyệt → Codex review trong chat → complete hoặc needs_human
```

Phase D bổ sung quality gate. Các check phải nằm trong plan đã duyệt và chạy
không qua shell ở worktree riêng. Bạn xem plan và review chủ yếu ngay trong
chat Codex; JSON/Markdown trong `.specrelay/` là artifact audit/resume, không
phải giao diện tài liệu bắt buộc phải đọc.

[Read the English README](README.md) · [Architecture](docs/architecture.md) ·
[Hướng dẫn beta](docs/beta-quickstart.vi.md) · [Kế hoạch dự án](docs/ke-hoach-open-source.md)

## Yêu cầu

- Node.js 22+
- npm 10+
- Git

Chỉ cần Claude Code khi gọi `specrelay implement`. Nếu giao diện Codex không
cho chạy shell, toàn bộ workflow vẫn dùng được từ terminal.

## Phát triển

```bash
npm install
npm run validate
```

```bash
npm run dev -- doctor --json
npm run dev -- init --repo path/to/a/git-repository --dry-run
npm run dev -- plan "Tạo module quản lý cơ sở giáo dục" --repo path/to/a/git-repository --json
```

## Quy trình Phase D

1. Codex làm rõ và hiển thị plan tiếng Việt trong chat. Front matter của
   `plan.md` có scope, acceptance criteria, open questions và `checks` rõ ràng.
2. Bạn duyệt rõ ràng trong cuộc trò chuyện hiện tại; khi đó mới chạy
   `specrelay approve <run-id> --yes`. Mọi byte của `plan.md` được hash; sửa
   sau approval sẽ làm plan `stale`.
3. Bạn xác nhận triển khai riêng; khi đó mới chạy
   `specrelay implement <run-id> --yes`. Lệnh từ chối base repo bẩn và tạo
   branch/worktree do SpecRelay sở hữu.
4. Khi executor thành công, `specrelay check` chạy tuần tự đúng các `argv` đã
   có trong plan, dừng ở check fail đầu tiên, timeout tối đa 10 phút và lưu
   output đã redact/giới hạn.
5. Nếu tất cả check pass, Codex dùng `review-packet` và `diff`, review trực
   tiếp trong chat trước, rồi ghi quyết định có schema bằng `record-review`.
6. Finding `blocking` hoặc `important` luôn đưa run sang `needs_human`; chỉ
   finding `minor` hoặc không finding mới có thể thành `complete`.

Ví dụ phần check trong plan được duyệt:

```yaml
checks:
  - id: lint
    preset: node
    argv: ["npm", "run", "lint"]
    timeout: "5m"
```

## Lệnh ở Phase D

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
specrelay check <run-id> [--repo <path>] [--json]
specrelay diff <run-id> [--repo <path>] [--stat] [-- <pathspec>] [--json]
specrelay review-packet <run-id> [--repo <path>] [--json]
specrelay record-review <run-id> --input <review.json> [--repo <path>] [--json]
specrelay report <run-id> [--repo <path>] [--json]
```

`report` cập nhật `final-report.json`: tóm tắt canonical của execution, checks,
review decision, branch và worktree. Không có `final-report.md`.

## Mặc định an toàn

- Không telemetry, không network request do SpecRelay tự tạo, không lưu credential.
- Approval gắn SHA-256 của `plan.md`; executor/check/review đều từ chối plan stale.
- Command thay đổi run dùng lock ngắn, JSON atomic và event append-only.
- Executor, check và Git diff dùng argument array, không dùng shell. Executor
  không dùng `--add-dir` hay `--dangerously-skip-permissions`.
- Preset check chỉ là metadata `node`/`python`/`go`; SpecRelay không tự đoán
  command và từ chối hành động package install.
- Đây là defense-in-depth, không phải sandbox. Chỉ chạy trên repo bạn tin cậy
  và tự kiểm tra worktree trước khi merge.

## Chưa có ở Phase D

Không auto-fix, resume executor, commit, push, merge, deploy, publish hay gọi
model API. `needs_human` luôn chờ quyết định của bạn ở phase sau.

SpecRelay dùng [Apache-2.0](LICENSE). Xem thêm
[CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) và
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
