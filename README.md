# SpecRelay

> Plan approval and review workflow for Codex and Claude Code.

SpecRelay is a local-first CLI and Codex plugin foundation for a safer agentic
development workflow:

1. A human reviews and approves an implementation plan.
2. An executor implements only the approved plan in a controlled workspace.
3. A separate reviewer evaluates the diff and the evidence.
4. A human keeps control of commit, push, merge, deployment, and destructive work.

Phase A provides the offline TypeScript foundation only. It does not yet create
plans, invoke Claude Code, perform code review, or modify a target repository
except through the explicit `specrelay init` command.

[Đọc bằng tiếng Việt](README.vi.md) · [Architecture](docs/architecture.md) ·
[Vietnamese project plan](docs/ke-hoach-open-source.md)

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Git

`codex` and `claude` are optional in Phase A. `specrelay doctor` reports their
availability but does not invoke either agent.

## Development

```bash
npm install
npm run validate
```

Run the development CLI directly:

```bash
npm run dev -- doctor --json
npm run dev -- init --repo path/to/a/git-repository --dry-run
```

Build the distributable CLI:

```bash
npm run build
node dist/cli/index.js --help
```

## Commands available in Phase A

```text
specrelay doctor [--repo <path>] [--json]
specrelay init [--repo <path>] [--dry-run] [--json]
```

`doctor` is read-only. `init` writes `.specrelay/config.json` and
`.specrelay/runs/` inside an existing Git repository, then adds `.specrelay/`
to that repository's local `.git/info/exclude`. It never changes `.gitignore`.

## Safety defaults

- No telemetry, network calls, or agent execution in Phase A.
- No API keys or credentials are read, stored, or sent.
- `init` refuses an unmanaged `.specrelay/` directory and does not overwrite a
  valid configuration.
- The CLI uses structured error codes for automation and troubleshooting.

## Open source

SpecRelay is licensed under [Apache-2.0](LICENSE). Please read
[CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the
[Code of Conduct](CODE_OF_CONDUCT.md) before participating.

SpecRelay is not affiliated with, endorsed by, or sponsored by OpenAI or
Anthropic. Codex and Claude Code are trademarks of their respective owners.
