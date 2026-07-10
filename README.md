# SpecRelay

> Human-approved, cross-model coding workflow for Codex and Claude Code.

SpecRelay is a local-first CLI and Codex plugin foundation for a controlled
software-delivery loop:

```text
Codex chat plans → human approves → Claude Code implements in a worktree
→ approved checks run → Codex reviews in chat → complete or needs_human
```

Phase D adds the quality gate. Checks are declared in the approved plan and
run without a shell in the isolated worktree. Codex reviews the resulting
diff directly in chat; JSON artifacts are for audit and resume, not a document
UI users are expected to read.

[Đọc bằng tiếng Việt](README.vi.md) · [Architecture](docs/architecture.md) ·
[Vietnamese project plan](docs/ke-hoach-open-source.md)

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Git

`claude` is required only for `specrelay implement`. `codex` is optional; the
CLI remains usable from a terminal when a Codex surface cannot run shell tools.

## Development

```bash
npm install
npm run validate
```

Run the development CLI directly:

```bash
npm run dev -- doctor --json
npm run dev -- init --repo path/to/a/git-repository --dry-run
npm run dev -- plan "Add education management" --repo path/to/a/git-repository --json
```

Build the distributable CLI:

```bash
npm run build
node dist/cli/index.js --help
```

## Phase D workflow

1. In Codex chat, clarify the request and review a Vietnamese plan. Its YAML
   front matter is canonical and contains scope, acceptance criteria, open
   questions, and explicit `checks`.
2. After a direct, current-chat approval, run `specrelay approve <run-id> --yes`.
   Approval hashes every byte of `plan.md`; any later edit makes it stale.
3. After a separate direct confirmation to spend Claude Code quota, run
   `specrelay implement <run-id> --yes`. It rejects a dirty base repository and
   creates an owned branch and isolated worktree.
4. When execution succeeds, `specrelay check` runs only the `argv` commands
   already approved in the plan. Checks run sequentially, stop on the first
   failure, use a 10-minute maximum timeout and persist bounded redacted output.
5. After all checks pass, `specrelay review-packet` and `specrelay diff` expose
   the evidence to Codex. Codex presents its findings in chat first, then
   persists the structured decision through `specrelay record-review`.
6. A `blocking` or `important` finding ends in `needs_human`; only minor/no
   findings can end in `complete`. SpecRelay never auto-fixes, commits, pushes,
   merges, deploys, or publishes.

Example check declaration in the approved `plan.md`:

```yaml
checks:
  - id: lint
    preset: node
    argv: ["npm", "run", "lint"]
    timeout: "5m"
```

## Commands available in Phase D

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

`report` refreshes `final-report.json`, the canonical summary of execution,
checks, review decision, branch, and worktree. There is deliberately no final
report Markdown file.

## Safety defaults

- No telemetry and no network request by SpecRelay itself.
- No credential storage. Bounded logs redact common credential patterns.
- `plan.md` approval is SHA-256-bound; executor, checks, and review gates reject
  a stale plan.
- Commands that change a run use a short exclusive lock, atomic JSON snapshots,
  and append-only events.
- `implement`, checks, and Git diff use argument arrays with no shell. The
  executor never uses `--add-dir` or `--dangerously-skip-permissions`.
- Check presets are metadata only (`node`, `python`, `go`); commands are never
  guessed and package-install actions are rejected.
- This is defense in depth, not a sandbox. Use only trusted repositories and
  inspect the worktree before any human-controlled merge.

## Not in Phase D

Phase D has no auto-fix, executor resume, commit, push, merge, deployment,
package publishing, or model API client. A `needs_human` outcome always waits
for a future user-directed phase.

## Open source

SpecRelay is licensed under [Apache-2.0](LICENSE). Read
[CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the
[Code of Conduct](CODE_OF_CONDUCT.md) before participating.

SpecRelay is not affiliated with, endorsed by, or sponsored by OpenAI or
Anthropic. Codex and Claude Code are trademarks of their respective owners.
